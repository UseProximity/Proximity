-- Chat attachments: images + PDFs in listing threads.
-- Files live in R2 under chat-attachments/{threadId}/…; keys stay in
-- chat_attachments (never in message metadata). Clients fetch via auth-gated API.
-- Apply to BOTH dev and prod.

-- ============================================================
-- Schema
-- ============================================================

ALTER TABLE public.chat_messages
  DROP CONSTRAINT IF EXISTS chat_messages_message_type_check;

ALTER TABLE public.chat_messages
  ADD CONSTRAINT chat_messages_message_type_check
  CHECK (message_type IN ('text', 'discount_offer', 'attachment'));

CREATE TABLE IF NOT EXISTS public.chat_attachments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id    uuid NOT NULL REFERENCES public.chat_messages(id) ON DELETE CASCADE,
  thread_id     uuid NOT NULL REFERENCES public.chat_threads(id) ON DELETE CASCADE,
  uploader_id   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  r2_key        text NOT NULL,
  file_name     text NOT NULL,
  content_type  text NOT NULL,
  size_bytes    bigint NOT NULL CHECK (size_bytes > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_attachments_r2_key_unique UNIQUE (r2_key)
);

CREATE INDEX IF NOT EXISTS chat_attachments_thread_id_idx
  ON public.chat_attachments (thread_id);

CREATE INDEX IF NOT EXISTS chat_attachments_message_id_idx
  ON public.chat_attachments (message_id);

COMMENT ON TABLE public.chat_attachments IS
  'Private chat file metadata. r2_key is server-only; clients get id/name/type/size via message metadata.';

-- ============================================================
-- Preview body helper (inbox + email quote)
-- ============================================================

CREATE OR REPLACE FUNCTION fn_chat_attachment_preview_body(
  p_caption     text,
  p_attachments jsonb
) RETURNS text
LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  v_caption text;
  v_count   integer;
  v_item    jsonb;
  v_images  integer := 0;
  v_pdfs    integer := 0;
  v_type    text;
BEGIN
  v_caption := NULLIF(btrim(COALESCE(p_caption, '')), '');
  IF v_caption IS NOT NULL THEN
    RETURN v_caption;
  END IF;

  IF p_attachments IS NULL OR jsonb_typeof(p_attachments) <> 'array' THEN
    RETURN 'Sent a file';
  END IF;

  v_count := jsonb_array_length(p_attachments);
  IF v_count <= 0 THEN
    RETURN 'Sent a file';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_attachments)
  LOOP
    v_type := lower(COALESCE(v_item->>'contentType', ''));
    IF v_type LIKE 'image/%' THEN
      v_images := v_images + 1;
    ELSIF v_type = 'application/pdf' THEN
      v_pdfs := v_pdfs + 1;
    END IF;
  END LOOP;

  IF v_count = 1 AND v_images = 1 THEN
    RETURN 'Sent a photo';
  END IF;
  IF v_count = 1 AND v_pdfs = 1 THEN
    RETURN 'Sent a PDF';
  END IF;
  IF v_images = v_count THEN
    RETURN format('Sent %s photos', v_count);
  END IF;
  IF v_pdfs = v_count THEN
    RETURN format('Sent %s PDFs', v_count);
  END IF;
  RETURN format('Sent %s files', v_count);
END;
$$;

-- ============================================================
-- rpc_send_chat_attachment_message
-- ============================================================

CREATE OR REPLACE FUNCTION rpc_send_chat_attachment_message(
  p_user_id     uuid,
  p_thread_id   uuid,
  p_body        text,
  p_attachments jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_caption       text;
  v_message_id    uuid;
  v_count         integer;
  v_item          jsonb;
  v_key           text;
  v_file_name     text;
  v_content_type  text;
  v_size_bytes    bigint;
  v_prefix        text;
  v_meta_atts     jsonb := '[]'::jsonb;
  v_allowed       text[] := ARRAY[
    'image/jpeg',
    'image/png',
    'image/webp',
    'image/gif',
    'application/pdf'
  ];
  v_max_files     integer := 5;
  v_max_bytes     bigint := 20 * 1024 * 1024;
BEGIN
  IF p_user_id IS NULL OR p_thread_id IS NULL THEN
    RAISE EXCEPTION 'user and thread are required';
  END IF;

  PERFORM fn_chat_assert_participant(p_user_id, p_thread_id);

  IF NOT EXISTS (
    SELECT 1 FROM chat_threads WHERE id = p_thread_id AND deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'conversation not found';
  END IF;

  IF p_attachments IS NULL OR jsonb_typeof(p_attachments) <> 'array' THEN
    RAISE EXCEPTION 'attachments are required';
  END IF;

  v_count := jsonb_array_length(p_attachments);
  IF v_count < 1 THEN
    RAISE EXCEPTION 'attachments are required';
  END IF;
  IF v_count > v_max_files THEN
    RAISE EXCEPTION 'too many attachments (max 5)';
  END IF;

  v_caption := NULLIF(btrim(COALESCE(p_body, '')), '');
  IF v_caption IS NOT NULL AND char_length(v_caption) > 5000 THEN
    RAISE EXCEPTION 'message body exceeds the 5000 character limit';
  END IF;

  v_prefix := 'chat-attachments/' || p_thread_id::text || '/';

  -- Validate every item before inserting anything.
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_attachments)
  LOOP
    v_key := NULLIF(btrim(COALESCE(v_item->>'key', '')), '');
    v_file_name := NULLIF(btrim(COALESCE(v_item->>'fileName', '')), '');
    v_content_type := lower(NULLIF(btrim(COALESCE(v_item->>'contentType', '')), ''));
    BEGIN
      v_size_bytes := (v_item->>'sizeBytes')::bigint;
    EXCEPTION WHEN others THEN
      RAISE EXCEPTION 'invalid attachment size';
    END;

    IF v_key IS NULL OR v_file_name IS NULL OR v_content_type IS NULL THEN
      RAISE EXCEPTION 'invalid attachment metadata';
    END IF;
    IF NOT (v_key LIKE v_prefix || '%') THEN
      RAISE EXCEPTION 'invalid attachment key';
    END IF;
    IF NOT (v_content_type = ANY (v_allowed)) THEN
      RAISE EXCEPTION 'unsupported attachment type';
    END IF;
    IF v_size_bytes IS NULL OR v_size_bytes <= 0 OR v_size_bytes > v_max_bytes THEN
      RAISE EXCEPTION 'attachment exceeds size limit';
    END IF;
    IF char_length(v_file_name) > 200 THEN
      RAISE EXCEPTION 'file name too long';
    END IF;
  END LOOP;

  PERFORM set_config('app.current_user_id', p_user_id::text, true);

  -- Pre-assign attachment ids so message metadata is complete on INSERT
  -- (Realtime subscribers see full payload without a follow-up UPDATE).
  CREATE TEMP TABLE _chat_att_draft (
    id uuid PRIMARY KEY,
    r2_key text NOT NULL,
    file_name text NOT NULL,
    content_type text NOT NULL,
    size_bytes bigint NOT NULL,
    sort_ord integer NOT NULL
  ) ON COMMIT DROP;

  v_count := 0;
  FOR v_item IN SELECT value FROM jsonb_array_elements(p_attachments)
  LOOP
    v_count := v_count + 1;
    INSERT INTO _chat_att_draft (id, r2_key, file_name, content_type, size_bytes, sort_ord)
    VALUES (
      gen_random_uuid(),
      btrim(v_item->>'key'),
      btrim(v_item->>'fileName'),
      lower(btrim(v_item->>'contentType')),
      (v_item->>'sizeBytes')::bigint,
      v_count
    );
  END LOOP;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', d.id,
        'fileName', d.file_name,
        'contentType', d.content_type,
        'sizeBytes', d.size_bytes
      )
      ORDER BY d.sort_ord
    ),
    '[]'::jsonb
  )
  INTO v_meta_atts
  FROM _chat_att_draft d;

  INSERT INTO chat_messages (thread_id, sender_id, body, message_type, metadata)
  VALUES (
    p_thread_id,
    p_user_id,
    fn_chat_attachment_preview_body(v_caption, p_attachments),
    'attachment',
    jsonb_build_object(
      'caption', v_caption,
      'attachments', v_meta_atts
    )
  )
  RETURNING id INTO v_message_id;

  INSERT INTO chat_attachments (
    id, message_id, thread_id, uploader_id, r2_key, file_name, content_type, size_bytes
  )
  SELECT
    d.id,
    v_message_id,
    p_thread_id,
    p_user_id,
    d.r2_key,
    d.file_name,
    d.content_type,
    d.size_bytes
  FROM _chat_att_draft d
  ORDER BY d.sort_ord;

  UPDATE chat_participants
  SET last_read_at = now()
  WHERE thread_id = p_thread_id AND user_id = p_user_id;

  RETURN jsonb_build_object('threadId', p_thread_id, 'messageId', v_message_id);
END;
$$;

-- ============================================================
-- rpc_get_chat_attachment — participant-gated lookup for download API
-- ============================================================

CREATE OR REPLACE FUNCTION rpc_get_chat_attachment(
  p_user_id       uuid,
  p_attachment_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_row record;
BEGIN
  IF p_user_id IS NULL OR p_attachment_id IS NULL THEN
    RAISE EXCEPTION 'user and attachment are required';
  END IF;

  SELECT
    a.id,
    a.thread_id,
    a.message_id,
    a.r2_key,
    a.file_name,
    a.content_type,
    a.size_bytes
  INTO v_row
  FROM chat_attachments a
  WHERE a.id = p_attachment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'attachment not found';
  END IF;

  PERFORM fn_chat_assert_participant(p_user_id, v_row.thread_id);

  RETURN jsonb_build_object(
    'id', v_row.id,
    'threadId', v_row.thread_id,
    'messageId', v_row.message_id,
    'r2Key', v_row.r2_key,
    'fileName', v_row.file_name,
    'contentType', v_row.content_type,
    'sizeBytes', v_row.size_bytes
  );
END;
$$;

-- ============================================================
-- Grants
-- ============================================================

DO $$
DECLARE
  fn          text;
  rolename    text;
  fns         text[] := ARRAY[
    'fn_chat_attachment_preview_body(text, jsonb)',
    'rpc_send_chat_attachment_message(uuid, uuid, text, jsonb)',
    'rpc_get_chat_attachment(uuid, uuid)'
  ];
  revoke_from text[] := ARRAY['anon', 'authenticated'];
BEGIN
  FOREACH fn IN ARRAY fns LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC;', fn);
    FOREACH rolename IN ARRAY revoke_from LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = rolename) THEN
        EXECUTE format('REVOKE ALL ON FUNCTION %s FROM %I;', fn, rolename);
      END IF;
    END LOOP;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role;', fn);
    END IF;
  END LOOP;
END $$;

ALTER TABLE public.chat_attachments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202608150006: chat_attachments + rpc_send_chat_attachment_message.';
END $$;

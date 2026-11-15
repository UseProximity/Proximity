-- Internal notes on a person or a listing, for the admin dashboard's record
-- pages (Wyatt, 2026-11-12). Never shown to landlords or students.
--
--   subject_type / subject_id   the user or listing the note is about. No
--                               foreign key: one table serves both, and a note
--                               should outlive a purged account.
--   follow_up_on                optional "check back on" date; the note counts
--                               as waiting until follow_up_done_at is set.
--   edited_at                   when the author last changed the text. Kept
--                               apart from updated_at, which also moves when
--                               a follow-up is ticked off.
--   author_id                   the team member who wrote it. Only the author
--                               edits or deletes (enforced in the API).
--
-- Service role only. Every change is kept in action_log, so an edited or
-- deleted note can still be read back.

CREATE TABLE IF NOT EXISTS public.admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type text NOT NULL CHECK (subject_type IN ('user', 'listing')),
  subject_id uuid NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  follow_up_on date,
  follow_up_done_at timestamptz,
  author_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Added after the table first reached dev (2026-11-14).
ALTER TABLE public.admin_notes ADD COLUMN IF NOT EXISTS edited_at timestamptz;

CREATE INDEX IF NOT EXISTS admin_notes_subject_idx
  ON public.admin_notes (subject_type, subject_id, created_at DESC);

CREATE INDEX IF NOT EXISTS admin_notes_follow_up_idx
  ON public.admin_notes (follow_up_on)
  WHERE follow_up_on IS NOT NULL AND follow_up_done_at IS NULL;

ALTER TABLE public.admin_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_notes FROM anon, authenticated;

DROP TRIGGER IF EXISTS trg_set_updated_at_admin_notes ON public.admin_notes;
CREATE TRIGGER trg_set_updated_at_admin_notes
  BEFORE UPDATE ON public.admin_notes
  FOR EACH ROW EXECUTE FUNCTION fn_set_updated_at();

DROP TRIGGER IF EXISTS trg_action_log_admin_notes ON public.admin_notes;
CREATE TRIGGER trg_action_log_admin_notes
  AFTER INSERT OR UPDATE OR DELETE ON public.admin_notes
  FOR EACH ROW EXECUTE FUNCTION fn_action_log();

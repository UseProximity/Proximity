-- Credential-portability seam for pms_connections (PMS v3, AppFolio brief §2/§5 P1.2).
--
-- Today every PMS credential lives in Nango (credential_mode = 'nango') and the
-- cred_* columns stay NULL — nothing reads or writes them yet. They exist so a
-- future move off Nango (price hike, shutdown) is a config flag plus a backfill,
-- not a rewrite under duress. If self-custody is ever enabled, the credential is
-- stored AES-256-GCM encrypted (ciphertext/iv/tag) under a versioned key, with a
-- fingerprint for dedupe/rotation checks.
--
-- The AppFolio subdomain is NOT a column: it goes in the existing
-- credential_meta jsonb as {"subdomain": "..."} (it is not a secret — it is the
-- same subdomain that serves the landlord's public listings page).

alter table pms_connections
  add column if not exists credential_mode text not null default 'nango',
  add column if not exists cred_ciphertext text,
  add column if not exists cred_iv text,
  add column if not exists cred_tag text,
  add column if not exists cred_key_version text,
  add column if not exists cred_fingerprint text;

comment on column pms_connections.credential_mode is
  'Where the PMS credential lives: nango (default, Nango vault) or a future self-custody mode. All code branches on this via callPms-style helpers.';

-- ═══════════════════════════════════════════════════════════════════
-- Run in Supabase → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Header (event + meta) ──────────────────────────────────────
create table public.registrations (
  id uuid not null default gen_random_uuid (),
  created_at timestamp with time zone null default now(),
  event text not null,
  event_date date not null,
  notes text null,
  status text null default 'pending'::text,
  edit_token uuid null default gen_random_uuid (),
  constraint registrations_pkey primary key (id),
  constraint registrations_edit_token_key unique (edit_token)
) TABLESPACE pg_default;

-- ── 2. All participants (including the group organiser) ───────────
create table public.participants (
  id uuid not null default gen_random_uuid (),
  registration_id uuid not null,
  is_head boolean null default false,
  name text not null,
  egn text not null,
  birth_date date null,
  age integer null,
  phone text null,
  email text null,
  constraint participants_pkey primary key (id),
  constraint participants_registration_id_fkey foreign KEY (registration_id) references registrations (id) on delete CASCADE
) TABLESPACE pg_default;

create index IF not exists idx_participants_head on public.participants using btree (registration_id) TABLESPACE pg_default;


-- ── 3. Row Level Security ─────────────────────────────────────────
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants  ENABLE ROW LEVEL SECURITY;

-- All inserts and deletes are handled by SECURITY DEFINER RPCs (sections 5–7).
-- No direct anon INSERT/DELETE policies — prevents bypassing validation and participant limits.
-- If you already applied these policies, drop them:
--   DROP POLICY IF EXISTS "anon_insert_reg" ON registrations;
--   DROP POLICY IF EXISTS "anon_insert_par" ON participants;
--   DROP POLICY IF EXISTS "anon_delete_par" ON participants;

-- ── 5. Participant read RPCs ──────────────────────────────────────

-- 5a. Public: returns participants only for the registration that owns this edit_token.
--     Caller must know the token — no token, no data.
CREATE OR REPLACE FUNCTION public.get_participants_by_token(p_token uuid)
RETURNS SETOF participants
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.*
  FROM participants p
  JOIN registrations r ON r.id = p.registration_id
  WHERE r.edit_token = p_token
  ORDER BY p.is_head DESC, p.name;
$$;
GRANT EXECUTE ON FUNCTION public.get_participants_by_token(uuid) TO anon;

-- 5b. Admin: returns all participants; validates admin key first.
CREATE OR REPLACE FUNCTION public.admin_get_all_participants(p_admin_key text)
RETURNS SETOF participants
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_keys WHERE key = p_admin_key) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
    SELECT * FROM participants
    ORDER BY registration_id, is_head DESC, name;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_all_participants(text) TO anon;


-- ── 6. Admin keys + RPC functions ────────────────────────────────
-- Table is locked down — anon cannot read it directly.
-- Access is only possible through the SECURITY DEFINER functions below.
CREATE TABLE public.admin_keys (
  key  text not null,
  label text null,
  created_at timestamp with time zone default now(),
  constraint admin_keys_pkey primary key (key)
) TABLESPACE pg_default;

ALTER TABLE admin_keys ENABLE ROW LEVEL SECURITY;
-- No anon SELECT policy → table is invisible to the anon key.

-- Generate and insert your admin key (replace the value below):
--   SELECT gen_random_uuid();   ← run this in SQL Editor to get a key
-- INSERT INTO admin_keys (key, label) VALUES ('paste-uuid-here', 'main admin');


-- Admin RPC functions (SECURITY DEFINER) —
-- these run with elevated privileges but validate the admin key first.
-- The anon key can call them; the admin_keys table remains inaccessible.

-- 6a. Validate key (returns true/false)
CREATE OR REPLACE FUNCTION public.check_admin_key(p_key text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM admin_keys WHERE key = p_key);
$$;
GRANT EXECUTE ON FUNCTION public.check_admin_key(text) TO anon;

-- 6b. Update registration status + notes (bypasses the 5-day UPDATE policy)
CREATE OR REPLACE FUNCTION public.admin_update_registration(
  p_admin_key text,
  p_reg_id    uuid,
  p_status    text,
  p_notes     text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_keys WHERE key = p_admin_key) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE registrations SET status = p_status, notes = p_notes WHERE id = p_reg_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_update_registration(text, uuid, text, text) TO anon;

-- 6c. Set status only
CREATE OR REPLACE FUNCTION public.admin_set_status(
  p_admin_key text,
  p_reg_id    uuid,
  p_status    text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_keys WHERE key = p_admin_key) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE registrations SET status = p_status WHERE id = p_reg_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_status(text, uuid, text) TO anon;

-- 6d. Atomically replace all participants for a registration
CREATE OR REPLACE FUNCTION public.admin_replace_participants(
  p_admin_key    text,
  p_reg_id       uuid,
  p_participants jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_keys WHERE key = p_admin_key) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  DELETE FROM participants WHERE registration_id = p_reg_id;

  INSERT INTO participants (registration_id, is_head, name, egn, birth_date, age, phone, email)
  SELECT
    p_reg_id,
    (elem->>'is_head')::boolean,
    elem->>'name',
    elem->>'egn',
    NULLIF(elem->>'birth_date', '')::date,
    NULLIF(elem->>'age',        '')::integer,
    NULLIF(elem->>'phone',      ''),
    NULLIF(elem->>'email',      '')
  FROM jsonb_array_elements(p_participants) AS elem;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_replace_participants(text, uuid, jsonb) TO anon;


-- ── 7. Lock down registrations table ─────────────────────────────
-- All registration reads and writes now go through SECURITY DEFINER RPCs.
-- edit_token is never returned to the client after this point.
--
-- Run these in SQL Editor if you already applied the earlier sections:
--   DROP POLICY IF EXISTS "anon_select_reg" ON registrations;
--   DROP POLICY IF EXISTS "anon_update_reg" ON registrations;

-- 7a. Create a new registration + participants atomically.
--     Returns {id, edit_token, event_date} needed for the confirmation email.
CREATE OR REPLACE FUNCTION public.create_registration(
  p_event        text,
  p_event_date   date,
  p_notes        text,
  p_participants jsonb
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg registrations%ROWTYPE;
BEGIN
  INSERT INTO registrations (event, event_date, notes, status)
  VALUES (p_event, p_event_date, p_notes, 'pending')
  RETURNING * INTO v_reg;

  INSERT INTO participants (registration_id, is_head, name, egn, birth_date, age, phone, email)
  SELECT
    v_reg.id,
    (elem->>'is_head')::boolean,
    elem->>'name',
    elem->>'egn',
    NULLIF(elem->>'birth_date', '')::date,
    NULLIF(elem->>'age',        '')::integer,
    NULLIF(elem->>'phone',      ''),
    NULLIF(elem->>'email',      '')
  FROM jsonb_array_elements(p_participants) AS elem;

  RETURN json_build_object(
    'id',         v_reg.id,
    'edit_token', v_reg.edit_token,
    'event_date', v_reg.event_date
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.create_registration(text, date, text, jsonb) TO anon;

-- 7b. Load one registration by edit_token — edit_token excluded from response (never sent to client)
CREATE OR REPLACE FUNCTION public.get_registration_by_token(p_token uuid)
RETURNS TABLE (
  id         uuid,
  created_at timestamptz,
  event      text,
  event_date date,
  notes      text,
  status     text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.id, r.created_at, r.event, r.event_date, r.notes, r.status
  FROM registrations r
  WHERE r.edit_token = p_token;
$$;
GRANT EXECUTE ON FUNCTION public.get_registration_by_token(uuid) TO anon;

-- 7c. Full edit: update notes + replace participants atomically
CREATE OR REPLACE FUNCTION public.update_registration_by_token(
  p_token        uuid,
  p_notes        text,
  p_participants jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg_id uuid;
BEGIN
  SELECT id INTO v_reg_id
  FROM registrations
  WHERE edit_token = p_token
    AND event_date > CURRENT_DATE + interval '5 days';

  IF v_reg_id IS NULL THEN
    RAISE EXCEPTION 'Невалиден или изтекъл линк';
  END IF;

  UPDATE registrations SET notes = p_notes WHERE id = v_reg_id;

  DELETE FROM participants WHERE registration_id = v_reg_id;

  INSERT INTO participants (registration_id, is_head, name, egn, birth_date, age, phone, email)
  SELECT
    v_reg_id,
    (elem->>'is_head')::boolean,
    elem->>'name',
    elem->>'egn',
    NULLIF(elem->>'birth_date', '')::date,
    NULLIF(elem->>'age',        '')::integer,
    NULLIF(elem->>'phone',      ''),
    NULLIF(elem->>'email',      '')
  FROM jsonb_array_elements(p_participants) AS elem;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_registration_by_token(uuid, text, jsonb) TO anon;

-- 7d. Confirm or cancel attendance by token
CREATE OR REPLACE FUNCTION public.set_registration_status_by_token(
  p_token  uuid,
  p_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg_id uuid;
BEGIN
  SELECT id INTO v_reg_id
  FROM registrations
  WHERE edit_token = p_token;

  IF v_reg_id IS NULL THEN
    RAISE EXCEPTION 'Невалиден линк';
  END IF;

  IF p_status NOT IN ('pending', 'confirmed', 'cancelled') THEN
    RAISE EXCEPTION 'Невалиден статус';
  END IF;

  UPDATE registrations SET status = p_status WHERE id = v_reg_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.set_registration_status_by_token(uuid, text) TO anon;

-- 7e. Admin: all registrations — edit_token deliberately excluded
CREATE OR REPLACE FUNCTION public.admin_get_all_registrations(p_admin_key text)
RETURNS TABLE (
  id         uuid,
  created_at timestamptz,
  event      text,
  event_date date,
  notes      text,
  status     text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_keys WHERE key = p_admin_key) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  RETURN QUERY
    SELECT r.id, r.created_at, r.event, r.event_date, r.notes, r.status
    FROM registrations r
    ORDER BY r.created_at DESC;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_all_registrations(text) TO anon;

-- 7f. Admin: fetch edit_token for a single registration (for confirmation email link only)
CREATE OR REPLACE FUNCTION public.admin_get_edit_token(p_admin_key text, p_reg_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_token uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_keys WHERE key = p_admin_key) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  SELECT edit_token INTO v_token FROM registrations WHERE id = p_reg_id;
  IF v_token IS NULL THEN RAISE EXCEPTION 'Записването не е намерено'; END IF;
  RETURN v_token::text;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_edit_token(text, uuid) TO anon;


-- ── 8. Edit-cutoff settings ───────────────────────────────────────────
-- Single-row table that stores the explicit datetime after which
-- organizers can no longer edit their registrations.
-- Protected by RLS — only accessible through SECURITY DEFINER RPCs.

CREATE TABLE IF NOT EXISTS public.settings (
  id          integer    PRIMARY KEY DEFAULT 1,
  edit_cutoff timestamptz NOT NULL,
  CONSTRAINT  settings_single_row CHECK (id = 1)
) TABLESPACE pg_default;

ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
-- No anon SELECT policy → table is invisible to the anon key.

-- Seed with a sensible default (adjust as needed before first use).
-- Always use UTC for the literal, or supply an explicit offset so PostgreSQL
-- converts to UTC on insert. timestamptz is stored as UTC internally.
-- Example: 2026-04-13 23:59:59 Sofia (UTC+3) = 2026-04-13 20:59:59 UTC
INSERT INTO settings (id, edit_cutoff)
VALUES (1, '2026-04-13 20:59:59Z')
ON CONFLICT (id) DO NOTHING;

-- 8a. Public: return the current edit cutoff (no auth — organizers need this to check expiry)
CREATE OR REPLACE FUNCTION public.get_edit_cutoff()
RETURNS timestamptz
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT edit_cutoff FROM settings WHERE id = 1;
$$;
GRANT EXECUTE ON FUNCTION public.get_edit_cutoff() TO anon;

-- 8b. Admin: return full settings object
CREATE OR REPLACE FUNCTION public.admin_get_settings(p_admin_key text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_cutoff timestamptz;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_keys WHERE key = p_admin_key) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  SELECT edit_cutoff INTO v_cutoff FROM settings WHERE id = 1;
  RETURN json_build_object('edit_cutoff', v_cutoff);
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_settings(text) TO anon;

-- 8c. Admin: update the edit cutoff
CREATE OR REPLACE FUNCTION public.admin_set_cutoff(p_admin_key text, p_cutoff timestamptz)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM admin_keys WHERE key = p_admin_key) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  UPDATE settings SET edit_cutoff = p_cutoff WHERE id = 1;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_set_cutoff(text, timestamptz) TO anon;

-- 8d. Replace the hardcoded 5-day guard in update_registration_by_token
--     with a check against the settings table.
CREATE OR REPLACE FUNCTION public.update_registration_by_token(
  p_token        uuid,
  p_notes        text,
  p_participants jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reg_id  uuid;
  v_cutoff  timestamptz;
BEGIN
  SELECT id INTO v_reg_id
  FROM registrations
  WHERE edit_token = p_token;

  IF v_reg_id IS NULL THEN
    RAISE EXCEPTION 'Невалиден или изтекъл линк';
  END IF;

  SELECT edit_cutoff INTO v_cutoff FROM settings WHERE id = 1;
  -- If settings row is missing, v_cutoff is NULL → IS NOT NULL check skips the block safely.
  -- This is intentional fail-open: a missing settings row should not lock out all edits.
  IF v_cutoff IS NOT NULL AND NOW() >= v_cutoff THEN
    RAISE EXCEPTION 'Линкът е изтекъл';
  END IF;

  UPDATE registrations SET notes = p_notes WHERE id = v_reg_id;

  DELETE FROM participants WHERE registration_id = v_reg_id;

  INSERT INTO participants (registration_id, is_head, name, egn, birth_date, age, phone, email)
  SELECT
    v_reg_id,
    (elem->>'is_head')::boolean,
    elem->>'name',
    elem->>'egn',
    NULLIF(elem->>'birth_date', '')::date,
    NULLIF(elem->>'age',        '')::integer,
    NULLIF(elem->>'phone',      ''),
    NULLIF(elem->>'email',      '')
  FROM jsonb_array_elements(p_participants) AS elem;
END;
$$;
GRANT EXECUTE ON FUNCTION public.update_registration_by_token(uuid, text, jsonb) TO anon;

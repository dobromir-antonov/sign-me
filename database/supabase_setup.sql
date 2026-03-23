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

-- INSERT: anon users may create a new registration
CREATE POLICY "anon_insert_reg" ON registrations
  FOR INSERT TO anon WITH CHECK (true);

-- SELECT: public read (anon key carries no custom claims, so token-based filtering
-- is not enforceable here — restrict sensitive queries via the service_role key instead)
CREATE POLICY "anon_select_reg" ON registrations
  FOR SELECT TO anon USING (true);

-- UPDATE: only when the event is more than 5 days away
-- (edit_token ownership is validated client-side; JWT claims are unavailable with the anon key)
CREATE POLICY "anon_update_reg" ON public.registrations
FOR UPDATE TO anon
USING (event_date > CURRENT_DATE + interval '5 days')
WITH CHECK (true);

-- INSERT participants
CREATE POLICY "anon_insert_par" ON participants
  FOR INSERT TO anon WITH CHECK (true);

-- SELECT participants: no direct anon access — use RPCs below instead.
-- (dropping the open policy closes the EGN enumeration vector)

-- DELETE participants: only for registrations whose event is more than 5 days away
-- (edit_token ownership is validated client-side; JWT claims are unavailable with the anon key)
CREATE POLICY "anon_delete_par" ON participants
  FOR DELETE TO anon
  USING (
    registration_id IN (
      SELECT id FROM registrations
      WHERE event_date > CURRENT_DATE + interval '5 days'
    )
  );

-- ── 4. Export view (for the insurer) ─────────────────────────────
-- NOTE: accessible by service_role only (not anon), as it contains personal ID numbers (EGN).
CREATE VIEW export_view AS
SELECT
  r.id            AS ref,
  r.event,
  r.event_date,
  r.status,
  r.created_at,
  p.is_head,
  p.name,
  p.egn,
  p.birth_date,
  p.age,
  p.phone,
  p.email
FROM registrations r
JOIN participants p ON p.registration_id = r.id
WHERE r.status != 'cancelled'
ORDER BY r.created_at, p.is_head DESC, p.name;


-- ── 5. Participant read RPCs ──────────────────────────────────────
-- Run this if you already applied the earlier SQL (removes the open policy):
-- DROP POLICY IF EXISTS "anon_select_par" ON participants;

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

-- 5b. Public: atomically replace participants for a registration.
--     Validates edit_token and the 5-day deadline server-side.
CREATE OR REPLACE FUNCTION public.replace_participants_by_token(
  p_token        uuid,
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
GRANT EXECUTE ON FUNCTION public.replace_participants_by_token(uuid, jsonb) TO anon;

-- 5c. Admin: returns all participants; validates admin key first.
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


-- ── 6. Admin key table ────────────────────────────────────────────
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


-- ── 6. Admin RPC functions (SECURITY DEFINER) ─────────────────────
-- These run with elevated privileges but validate the admin key first.
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

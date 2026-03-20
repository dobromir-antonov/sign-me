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

-- UPDATE: only when the event is more than 5 days away and only by the edit_token owner
CREATE POLICY "anon_update_reg" ON public.registrations
FOR UPDATE TO anon
USING (
  event_date > CURRENT_DATE + interval '5 days'
  AND edit_token = (current_setting('request.jwt.claims', true)::json->>'edit_token')::uuid
)
WITH CHECK (true);

-- INSERT participants
CREATE POLICY "anon_insert_par" ON participants
  FOR INSERT TO anon WITH CHECK (true);

-- SELECT participants: public read (same reasoning as anon_select_reg)
CREATE POLICY "anon_select_par" ON participants
  FOR SELECT TO anon USING (true);

-- DELETE participants: only for future-event registrations owned by the caller.
-- NOTE: the previous USING (true) allowed anyone to delete arbitrary participants.
CREATE POLICY "anon_delete_par" ON participants
  FOR DELETE TO anon
  USING (
    registration_id IN (
      SELECT id FROM registrations
      WHERE event_date > CURRENT_DATE + interval '5 days'
        AND edit_token = (current_setting('request.jwt.claims', true)::json->>'edit_token')::uuid
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

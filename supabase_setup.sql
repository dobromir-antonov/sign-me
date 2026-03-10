-- ═══════════════════════════════════════════════════════════════════
-- Изпълни в Supabase → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Header (събитие + мета) ────────────────────────────────────
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

-- ── 2. Всички участници (включително организаторът) ───────────────
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

CREATE POLICY "anon_insert_reg" ON registrations
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_select_reg" ON registrations
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_update_reg" ON public.registrations
FOR UPDATE TO anon
USING (event_date >= CURRENT_DATE)
WITH CHECK (true);

CREATE POLICY "anon_insert_par" ON participants
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_select_par" ON participants
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_delete_par" ON participants
  FOR DELETE TO anon USING (true);

-- ── 4. Export view (за застрахователя) ───────────────────────────
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
JOIN participants p ON p.head_id = r.id
WHERE r.status != 'cancelled'
ORDER BY r.created_at, p.is_head DESC, p.name;

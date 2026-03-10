-- ═══════════════════════════════════════════════════════════════════
-- Изпълни в Supabase → SQL Editor → New query → Run
-- ═══════════════════════════════════════════════════════════════════

-- ── 1. Header (събитие + мета) ────────────────────────────────────
CREATE TABLE registrations (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at     timestamptz DEFAULT now(),
  event          text NOT NULL,
  event_date     date NOT NULL,
  notes          text,
  decl_insurance boolean DEFAULT false,
  decl_terms     boolean DEFAULT false,
  status         text DEFAULT 'pending',      -- pending / confirmed / cancelled
  edit_token     uuid DEFAULT gen_random_uuid() UNIQUE
);

-- ── 2. Всички участници (включително организаторът) ───────────────
CREATE TABLE participants (
  id           uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  head_id      uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  is_head      boolean DEFAULT false,   -- true = организатор
  name         text NOT NULL,
  egn          text NOT NULL,
  birth_date   date,                    -- auto от ЕГН
  age          int,                     -- auto към event_date
  phone        text,                    -- задължително само за организатора
  email        text                     -- задължително само за организатора
);

CREATE INDEX idx_participants_head ON participants(head_id);

-- ── 3. Row Level Security ─────────────────────────────────────────
ALTER TABLE registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE participants  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anon_insert_reg" ON registrations
  FOR INSERT TO anon WITH CHECK (true);

CREATE POLICY "anon_select_reg" ON registrations
  FOR SELECT TO anon USING (true);

CREATE POLICY "anon_update_reg" ON registrations
  FOR UPDATE TO anon USING (event_date >= CURRENT_DATE);

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

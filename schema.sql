-- ╔══════════════════════════════════════════════╗
-- ║  GymBot Pro — Complete Database Schema       ║
-- ║  Run this in Supabase SQL Editor             ║
-- ╚══════════════════════════════════════════════╝

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─────────────────────────────────────────
-- TRAINERS TABLE
-- ─────────────────────────────────────────
CREATE TABLE trainers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  phone             TEXT UNIQUE NOT NULL,
  email             TEXT,
  specializations   TEXT[] DEFAULT '{}',  -- ['weightloss', 'muscle', 'general']
  current_load      INTEGER DEFAULT 0,
  max_load          INTEGER DEFAULT 30,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- MEMBERS TABLE
-- ─────────────────────────────────────────
CREATE TABLE members (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT NOT NULL,
  phone                 TEXT UNIQUE NOT NULL,
  email                 TEXT,
  plan                  TEXT CHECK (plan IN ('monthly','3month','6month','annual')) NOT NULL,
  plan_name             TEXT,
  join_date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expiry_date           TIMESTAMPTZ NOT NULL,
  status                TEXT CHECK (status IN ('pending','active','paused','expired','cancelled')) DEFAULT 'pending',
  batch_time            TEXT DEFAULT '7:00 AM',
  fitness_goal          TEXT CHECK (fitness_goal IN ('weightloss','muscle','general','endurance')) DEFAULT 'general',
  trainer_id            UUID REFERENCES trainers(id),
  
  -- Personal details (from intake form)
  dob                   DATE,
  age                   INTEGER,
  weight_kg             DECIMAL(5,2),
  height_cm             DECIMAL(5,2),
  health_issues         TEXT,
  emergency_contact     TEXT,
  
  -- Tracking
  sessions_attended     INTEGER DEFAULT 0,
  checked_in_today      BOOLEAN DEFAULT false,
  last_checkin          TIMESTAMPTZ,
  paused_until          TIMESTAMPTZ,
  form_submitted_at     TIMESTAMPTZ,
  
  -- Payment
  last_payment_date     TIMESTAMPTZ,
  last_payment_amount   DECIMAL(10,2),
  last_payment_id       TEXT,
  
  -- Reminders
  reminder1_sent_at     TIMESTAMPTZ,
  reminder2_sent_at     TIMESTAMPTZ,
  reminder3_sent_at     TIMESTAMPTZ,
  
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- CONVERSATION STATE (for bot memory)
-- ─────────────────────────────────────────
CREATE TABLE conversation_states (
  phone       TEXT PRIMARY KEY,
  state       TEXT NOT NULL DEFAULT 'idle',
  metadata    JSONB DEFAULT '{}',
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- MESSAGE LOGS
-- ─────────────────────────────────────────
CREATE TABLE message_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id     UUID REFERENCES members(id),
  phone         TEXT NOT NULL,
  direction     TEXT CHECK (direction IN ('inbound','outbound')) NOT NULL,
  message_type  TEXT,  -- template, text, interactive, etc.
  template_name TEXT,
  content       TEXT,
  wa_message_id TEXT,
  status        TEXT DEFAULT 'sent',  -- sent, delivered, read, failed
  sent_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- PAYMENT REMINDERS LOG
-- ─────────────────────────────────────────
CREATE TABLE payment_reminders (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id         UUID REFERENCES members(id),
  reminder_num      INTEGER,
  payment_link_id   TEXT,
  amount            DECIMAL(10,2),
  sent_at           TIMESTAMPTZ DEFAULT NOW(),
  paid_at           TIMESTAMPTZ,
  payment_id        TEXT
);

-- ─────────────────────────────────────────
-- AUTOMATION LOGS (audit trail)
-- ─────────────────────────────────────────
CREATE TABLE automation_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID REFERENCES members(id),
  event       TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- CHECK-INS
-- ─────────────────────────────────────────
CREATE TABLE checkins (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_id   UUID REFERENCES members(id) NOT NULL,
  checked_in  TIMESTAMPTZ DEFAULT NOW(),
  method      TEXT DEFAULT 'qr'  -- qr, manual, face
);

-- ─────────────────────────────────────────
-- BROADCASTS
-- ─────────────────────────────────────────
CREATE TABLE broadcasts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  template_name   TEXT NOT NULL,
  target_filter   JSONB DEFAULT '{}',
  total_sent      INTEGER DEFAULT 0,
  total_delivered INTEGER DEFAULT 0,
  total_read      INTEGER DEFAULT 0,
  scheduled_at    TIMESTAMPTZ,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ─────────────────────────────────────────
-- INDEXES FOR PERFORMANCE
-- ─────────────────────────────────────────
CREATE INDEX idx_members_phone ON members(phone);
CREATE INDEX idx_members_status ON members(status);
CREATE INDEX idx_members_expiry ON members(expiry_date);
CREATE INDEX idx_members_trainer ON members(trainer_id);
CREATE INDEX idx_checkins_member ON checkins(member_id);
CREATE INDEX idx_checkins_date ON checkins(checked_in);
CREATE INDEX idx_message_logs_member ON message_logs(member_id);
CREATE INDEX idx_automation_logs_member ON automation_logs(member_id);

-- ─────────────────────────────────────────
-- AUTO-UPDATE updated_at TRIGGER
-- ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER members_updated_at
BEFORE UPDATE ON members
FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ─────────────────────────────────────────
-- DAILY RESET: checked_in_today (run via cron)
-- ─────────────────────────────────────────
-- Add this as a Supabase scheduled function:
-- UPDATE members SET checked_in_today = false WHERE checked_in_today = true;

-- ─────────────────────────────────────────
-- SAMPLE DATA (remove in production)
-- ─────────────────────────────────────────
INSERT INTO trainers (name, phone, specializations, max_load) VALUES
  ('Rajesh Kumar', '9876500001', ARRAY['weightloss','general'], 25),
  ('Sunita Sharma', '9876500002', ARRAY['muscle','endurance'], 20),
  ('Vikram Singh', '9876500003', ARRAY['general','weightloss'], 30);

-- ─────────────────────────────────────────
-- ROW LEVEL SECURITY (enable for production)
-- ─────────────────────────────────────────
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainers ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;

-- Service role can do anything (used by backend)
CREATE POLICY "service_role_all" ON members FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all" ON trainers FOR ALL TO service_role USING (true);
CREATE POLICY "service_role_all" ON message_logs FOR ALL TO service_role USING (true);

/*
  # Complete GymBot Pro Database Schema with Multi-Tenancy & Integrations

  ## Sections
  1. Tenants (multi-tenancy support)
  2. WhatsApp Providers (dynamic provider support)
  3. Base tables (members, trainers, etc.)
  4. Integrations & event system
  5. RLS policies
*/

-- ─────────────────────────────────────────
-- Enable extensions
-- ─────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═════════════════════════════════════════
-- 1. TENANTS (multi-tenancy root)
-- ═════════════════════════════════════════
CREATE TABLE IF NOT EXISTS tenants (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              TEXT NOT NULL,
  slug              TEXT UNIQUE NOT NULL,
  phone_number_id   TEXT,
  api_key           TEXT UNIQUE,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_phone_id ON tenants(phone_number_id);

-- ═════════════════════════════════════════
-- 2. WHATSAPP PROVIDERS (dynamic)
-- ═════════════════════════════════════════
CREATE TABLE IF NOT EXISTS whatsapp_providers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider    TEXT NOT NULL DEFAULT 'meta_cloud'
              CHECK (provider IN ('meta_cloud','wati','twilio','messagebird','vonage','custom')),
  label       TEXT NOT NULL DEFAULT '',
  config      JSONB NOT NULL DEFAULT '{}',
  is_active   BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wa_providers_tenant ON whatsapp_providers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_wa_providers_active ON whatsapp_providers(tenant_id, is_active);

-- ═════════════════════════════════════════
-- 3. BASE TABLES
-- ═════════════════════════════════════════

-- TRAINERS
CREATE TABLE IF NOT EXISTS trainers (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  phone             TEXT NOT NULL,
  email             TEXT,
  specializations   TEXT[] DEFAULT '{}',
  current_load      INTEGER DEFAULT 0,
  max_load          INTEGER DEFAULT 30,
  is_active         BOOLEAN DEFAULT true,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_trainers_tenant ON trainers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_trainers_phone ON trainers(phone);

-- MEMBERS
CREATE TABLE IF NOT EXISTS members (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id             UUID REFERENCES tenants(id) ON DELETE CASCADE,
  name                  TEXT NOT NULL,
  phone                 TEXT NOT NULL,
  email                 TEXT,
  plan                  TEXT CHECK (plan IN ('monthly','3month','6month','annual')) NOT NULL,
  plan_name             TEXT,
  join_date             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expiry_date           TIMESTAMPTZ NOT NULL,
  status                TEXT CHECK (status IN ('pending','active','paused','expired','cancelled')) DEFAULT 'pending',
  batch_time            TEXT DEFAULT '7:00 AM',
  fitness_goal          TEXT CHECK (fitness_goal IN ('weightloss','muscle','general','endurance')) DEFAULT 'general',
  trainer_id            UUID REFERENCES trainers(id),
  dob                   DATE,
  age                   INTEGER,
  weight_kg             DECIMAL(5,2),
  height_cm             DECIMAL(5,2),
  health_issues         TEXT,
  emergency_contact     TEXT,
  sessions_attended     INTEGER DEFAULT 0,
  checked_in_today      BOOLEAN DEFAULT false,
  last_checkin          TIMESTAMPTZ,
  paused_until          TIMESTAMPTZ,
  form_submitted_at     TIMESTAMPTZ,
  last_payment_date     TIMESTAMPTZ,
  last_payment_amount   DECIMAL(10,2),
  last_payment_id       TEXT,
  reminder1_sent_at     TIMESTAMPTZ,
  reminder2_sent_at     TIMESTAMPTZ,
  reminder3_sent_at     TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_members_tenant ON members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_members_phone ON members(tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_members_status ON members(tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_members_expiry ON members(tenant_id, expiry_date);
CREATE INDEX IF NOT EXISTS idx_members_trainer ON members(trainer_id);

-- CONVERSATION STATES
CREATE TABLE IF NOT EXISTS conversation_states (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  phone     TEXT NOT NULL,
  state     TEXT NOT NULL DEFAULT 'idle',
  metadata  JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_conv_states_tenant_phone ON conversation_states(tenant_id, phone);

-- MESSAGE LOGS
CREATE TABLE IF NOT EXISTS message_logs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id     UUID REFERENCES tenants(id) ON DELETE CASCADE,
  member_id     UUID REFERENCES members(id),
  phone         TEXT NOT NULL,
  direction     TEXT CHECK (direction IN ('inbound','outbound')) NOT NULL,
  message_type  TEXT,
  template_name TEXT,
  content       TEXT,
  wa_message_id TEXT,
  status        TEXT DEFAULT 'sent',
  sent_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_msg_logs_tenant ON message_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_msg_logs_member ON message_logs(member_id);
CREATE INDEX IF NOT EXISTS idx_msg_logs_date ON message_logs(tenant_id, sent_at DESC);

-- PAYMENT REMINDERS
CREATE TABLE IF NOT EXISTS payment_reminders (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID REFERENCES tenants(id) ON DELETE CASCADE,
  member_id         UUID REFERENCES members(id),
  reminder_num      INTEGER,
  payment_link_id   TEXT,
  amount            DECIMAL(10,2),
  sent_at           TIMESTAMPTZ DEFAULT NOW(),
  paid_at           TIMESTAMPTZ,
  payment_id        TEXT
);

CREATE INDEX IF NOT EXISTS idx_pay_rem_tenant ON payment_reminders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_pay_rem_member ON payment_reminders(member_id);

-- AUTOMATION LOGS
CREATE TABLE IF NOT EXISTS automation_logs (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  member_id   UUID REFERENCES members(id),
  event       TEXT NOT NULL,
  metadata    JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auto_logs_tenant ON automation_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_auto_logs_event ON automation_logs(event);

-- CHECK-INS
CREATE TABLE IF NOT EXISTS checkins (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id   UUID REFERENCES tenants(id) ON DELETE CASCADE,
  member_id   UUID REFERENCES members(id) NOT NULL,
  checked_in  TIMESTAMPTZ DEFAULT NOW(),
  method      TEXT DEFAULT 'qr'
);

CREATE INDEX IF NOT EXISTS idx_checkins_tenant ON checkins(tenant_id);
CREATE INDEX IF NOT EXISTS idx_checkins_member ON checkins(member_id);

-- BROADCASTS
CREATE TABLE IF NOT EXISTS broadcasts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id       UUID REFERENCES tenants(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_broadcasts_tenant ON broadcasts(tenant_id);

-- ═════════════════════════════════════════
-- 4. INTEGRATIONS & EVENT SYSTEM
-- ═════════════════════════════════════════

-- INTEGRATIONS (n8n, Zapier, Make, WATI, Twilio, etc.)
CREATE TABLE IF NOT EXISTS integrations (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                TEXT NOT NULL DEFAULT '',
  type                TEXT NOT NULL DEFAULT 'webhook_outbound'
                      CHECK (type IN ('webhook_outbound','whatsapp_provider','crm','payment','custom')),
  provider            TEXT NOT NULL DEFAULT 'custom',
  config              JSONB NOT NULL DEFAULT '{}',
  events              TEXT[] NOT NULL DEFAULT '{}',
  is_active           BOOLEAN NOT NULL DEFAULT true,
  last_triggered_at   TIMESTAMPTZ,
  last_error          TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_integrations_tenant ON integrations(tenant_id);
CREATE INDEX IF NOT EXISTS idx_integrations_type ON integrations(type);
CREATE INDEX IF NOT EXISTS idx_integrations_active ON integrations(tenant_id, is_active);

-- INTEGRATION EVENT LOGS (audit trail)
CREATE TABLE IF NOT EXISTS integration_event_logs (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id         UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  integration_id    UUID REFERENCES integrations(id) ON DELETE SET NULL,
  event_type        TEXT NOT NULL,
  payload           JSONB NOT NULL DEFAULT '{}',
  response_status   INTEGER,
  response_body     TEXT,
  duration_ms       INTEGER,
  success           BOOLEAN NOT NULL DEFAULT false,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_int_logs_tenant ON integration_event_logs(tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_int_logs_integration ON integration_event_logs(integration_id, created_at DESC);

-- ═════════════════════════════════════════
-- 5. TRIGGERS
-- ═════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tenants_updated_at ON tenants;
CREATE TRIGGER tenants_updated_at BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS members_updated_at ON members;
CREATE TRIGGER members_updated_at BEFORE UPDATE ON members FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS integrations_updated_at ON integrations;
CREATE TRIGGER integrations_updated_at BEFORE UPDATE ON integrations FOR EACH ROW EXECUTE FUNCTION update_updated_at();

DROP TRIGGER IF EXISTS wa_providers_updated_at ON whatsapp_providers;
CREATE TRIGGER wa_providers_updated_at BEFORE UPDATE ON whatsapp_providers FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═════════════════════════════════════════
-- 6. ROW LEVEL SECURITY
-- ═════════════════════════════════════════
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE integrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE integration_event_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE trainers ENABLE ROW LEVEL SECURITY;
ALTER TABLE members ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_logs ENABLE ROW LEVEL SECURITY;

-- Service role has all access
CREATE POLICY "service_role_all" ON tenants FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON integrations FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON integration_event_logs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON whatsapp_providers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON trainers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON members FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "service_role_all" ON message_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

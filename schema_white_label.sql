-- White-label & admin config (run in Supabase SQL after schema.sql)
-- One logical gym per deployment; all branding/automation/plan data editable via Admin API

CREATE TABLE IF NOT EXISTS gym_instance_config (
  id                 TEXT PRIMARY KEY DEFAULT 'default',
  brand_name         TEXT,
  support_phone      TEXT,
  website_url        TEXT,
  intake_form_url    TEXT,
  cdn_base_url       TEXT,
  address            TEXT,
  timezone           TEXT DEFAULT 'Asia/Kolkata',
  phone_number_id    TEXT,
  -- Feature flags: { "morningMotivation": true, "paymentReminders": true, ... }
  automations        JSONB NOT NULL DEFAULT '{}',
  -- Optional override for Razorpay amounts (rupees) + display names
  -- e.g. { "monthly": { "amount": 1999, "name": "Monthly Plan" }, "3month": {...} }
  plan_prices        JSONB NOT NULL DEFAULT '{}',
  created_at         TIMESTAMPTZ DEFAULT NOW(),
  updated_at         TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO gym_instance_config (id) VALUES ('default') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS error_events (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  source      TEXT NOT NULL,
  message     TEXT,
  detail      TEXT,
  stack       TEXT,
  context     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_error_events_created ON error_events (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_gym_config_phone_id ON gym_instance_config (phone_number_id);

ALTER TABLE gym_instance_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE error_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_gym_config" ON gym_instance_config;
CREATE POLICY "service_role_gym_config" ON gym_instance_config
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_errors" ON error_events;
CREATE POLICY "service_role_errors" ON error_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

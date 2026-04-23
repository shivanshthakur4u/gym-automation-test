-- Multi-tenant migration — run in Supabase SQL after schema.sql + schema_white_label.sql
-- Backs up concept: one row in `tenants` per gym; WhatsApp `phone_number_id` maps to a tenant

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Fixed default tenant id (set DEFAULT_TENANT_ID in .env to match)
-- Note: 00000000-0000-0000-0000-000000000000 is not valid in all contexts; we use 0000...1
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS tenants (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                 TEXT NOT NULL,
  slug                 TEXT NOT NULL,
  wa_phone_number_id   TEXT,
  is_active            BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_slug ON tenants (slug);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenants_wa_phone ON tenants (wa_phone_number_id) WHERE wa_phone_number_id IS NOT NULL;

INSERT INTO tenants (id, name, slug, wa_phone_number_id)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Default gym',
  'default',
  NULL
) ON CONFLICT (id) DO NOTHING;

-- ─── Members: tenant scope + unique phone per tenant ─────────────────
ALTER TABLE members ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants (id);
UPDATE members SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE members ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE members DROP CONSTRAINT IF EXISTS members_phone_key;
DROP INDEX IF EXISTS members_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_members_tenant_phone ON members (tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_members_tenant ON members (tenant_id);

-- ─── Trainers: tenant scope ──────────────────────────────────────────
ALTER TABLE trainers ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants (id);
UPDATE trainers SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE trainers ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE trainers DROP CONSTRAINT IF EXISTS trainers_phone_key;
DROP INDEX IF EXISTS trainers_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_trainers_tenant_phone ON trainers (tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_trainers_tenant ON trainers (tenant_id);

-- ─── Conversation state: composite PK (tenant, phone) ────────────────
ALTER TABLE conversation_states ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants (id);
UPDATE conversation_states SET tenant_id = '00000000-0000-0000-0000-000000000001' WHERE tenant_id IS NULL;
ALTER TABLE conversation_states ALTER COLUMN tenant_id SET NOT NULL;

ALTER TABLE conversation_states DROP CONSTRAINT IF EXISTS conversation_states_pkey;
DROP INDEX IF EXISTS idx_conv_tenant_phone;
ALTER TABLE conversation_states ADD PRIMARY KEY (tenant_id, phone);

-- ─── Gym config: bind to tenant (one row per tenant) ───────────────────
ALTER TABLE gym_instance_config ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants (id);
UPDATE gym_instance_config g
SET tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE g.tenant_id IS NULL
  AND g.id = 'default';

-- New installs may only have id default: ensure row exists
INSERT INTO gym_instance_config (id, tenant_id)
SELECT 'default', '00000000-0000-0000-0000-000000000001'
WHERE NOT EXISTS (SELECT 1 FROM gym_instance_config WHERE tenant_id = '00000000-0000-0000-0000-000000000001');

-- One config row per tenant: align PK id with tenant uuid for simpler lookups
UPDATE gym_instance_config
SET
  id = '00000000-0000-0000-0000-000000000001',
  tenant_id = '00000000-0000-0000-0000-000000000001'
WHERE id = 'default'
  OR tenant_id = '00000000-0000-0000-0000-000000000001';

CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_config_tenant ON gym_instance_config (tenant_id);

-- Sync Meta phone id from gym config into tenants (optional, for routing)
UPDATE tenants t
SET wa_phone_number_id = g.phone_number_id
FROM gym_instance_config g
WHERE g.tenant_id = t.id
  AND g.phone_number_id IS NOT NULL
  AND t.wa_phone_number_id IS NULL;

-- ─── Error log: optional tenant for filtering ───────────────────────
ALTER TABLE error_events ADD COLUMN IF NOT EXISTS tenant_id UUID REFERENCES tenants (id);
CREATE INDEX IF NOT EXISTS idx_error_tenant ON error_events (tenant_id);

-- ─── RLS (service role keeps full access) ────────────────────────────
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "service_role_tenants" ON tenants;
CREATE POLICY "service_role_tenants" ON tenants FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS messaging_templates (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  template_key TEXT NOT NULL,
  name TEXT NOT NULL,
  channel TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, template_key)
);

CREATE TABLE IF NOT EXISTS message_deliveries (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  template_id UUID REFERENCES messaging_templates(id) ON DELETE SET NULL,
  recipient TEXT NOT NULL,
  channel TEXT NOT NULL,
  subject TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  provider_message_id TEXT,
  error_message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_messaging_templates_org_created
  ON messaging_templates (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_org_created
  ON message_deliveries (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_message_deliveries_status
  ON message_deliveries (status);

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  metric TEXT NOT NULL,
  value NUMERIC(12, 2) NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_reports (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  leads INT NOT NULL DEFAULT 0,
  conversions INT NOT NULL DEFAULT 0,
  conversion_rate NUMERIC(8, 2) NOT NULL DEFAULT 0,
  messages_sent INT NOT NULL DEFAULT 0,
  invoices_paid INT NOT NULL DEFAULT 0,
  revenue NUMERIC(12, 2) NOT NULL DEFAULT 0,
  metadata JSONB,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_org_occurred
  ON analytics_events (organization_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_reports_org_generated
  ON analytics_reports (organization_id, generated_at DESC);

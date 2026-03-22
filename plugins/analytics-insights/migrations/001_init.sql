CREATE TABLE IF NOT EXISTS analytics_insights_records (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  title TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_insights_records_org_created
  ON analytics_insights_records (organization_id, created_at DESC);

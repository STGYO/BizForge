CREATE TABLE IF NOT EXISTS automation_engine_records (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  title TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_automation_engine_records_org_created
  ON automation_engine_records (organization_id, created_at DESC);

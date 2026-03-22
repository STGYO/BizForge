CREATE TABLE IF NOT EXISTS plugin_manager_records (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  title TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_plugin_manager_records_org_created
  ON plugin_manager_records (organization_id, created_at DESC);

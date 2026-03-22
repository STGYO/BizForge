CREATE TABLE IF NOT EXISTS leads_manager_leads (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  owner_name TEXT NOT NULL DEFAULT 'unassigned',
  stage TEXT NOT NULL DEFAULT 'new',
  score INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_manager_leads_org_stage_created
  ON leads_manager_leads (organization_id, stage, created_at DESC);

CREATE TABLE IF NOT EXISTS leads_manager_stage_history (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  lead_id UUID NOT NULL,
  previous_stage TEXT NOT NULL,
  next_stage TEXT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leads_manager_stage_history_lead_changed
  ON leads_manager_stage_history (lead_id, changed_at DESC);

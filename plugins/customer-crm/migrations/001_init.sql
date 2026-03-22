CREATE TABLE IF NOT EXISTS customer_crm_customers (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::JSONB,
  notes JSONB NOT NULL DEFAULT '[]'::JSONB,
  last_interaction_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_crm_customers_org_created
  ON customer_crm_customers (organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS customer_crm_interactions (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  interaction_type TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customer_crm_interactions_customer_created
  ON customer_crm_interactions (customer_id, created_at DESC);

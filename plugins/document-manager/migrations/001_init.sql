CREATE TABLE IF NOT EXISTS managed_documents (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL,
  title TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  category TEXT NOT NULL,
  visibility TEXT NOT NULL,
  latest_version INT NOT NULL DEFAULT 1,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS document_versions (
  id UUID PRIMARY KEY,
  document_id UUID NOT NULL REFERENCES managed_documents(id) ON DELETE CASCADE,
  version_number INT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  uploaded_by TEXT NOT NULL,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_managed_documents_org_updated
  ON managed_documents (organization_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_document_versions_doc_version
  ON document_versions (document_id, version_number DESC);

-- Archiv erstellter Berichte (PDF/ZIP liegen in R2)
CREATE TABLE reports (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_key TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  property_id TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_reports_tenant ON reports(tenant_id, created_at);

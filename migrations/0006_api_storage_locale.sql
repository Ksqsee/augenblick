-- API-Zugangsschlüssel (nur der SHA-256-Hash wird gespeichert)
CREATE TABLE api_keys (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  key_hash TEXT NOT NULL UNIQUE,
  scope TEXT NOT NULL CHECK (scope IN ('read', 'write')),
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  last_used_at INTEGER,
  revoked_at INTEGER
);
CREATE INDEX idx_api_keys_tenant ON api_keys(tenant_id);

-- Sprache (Dokumente) und Zeitzone je Workspace
ALTER TABLE tenants ADD COLUMN language TEXT NOT NULL DEFAULT 'de';
ALTER TABLE tenants ADD COLUMN timezone TEXT NOT NULL DEFAULT 'Europe/Berlin';

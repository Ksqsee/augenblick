-- Kunden-Freigabe: Link je Objekt (nur lesend, ohne Konto). Gespeichert wird nur der Hash des Links.
CREATE TABLE property_shares (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  show_defects INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER,
  revoked_at INTEGER,
  last_viewed_at INTEGER,
  views INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_property_shares_property ON property_shares(tenant_id, property_id);

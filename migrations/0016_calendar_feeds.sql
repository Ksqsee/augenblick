-- Kalender-Abo (iCal) je Person und Workspace; gespeichert wird nur der Hash des Links
CREATE TABLE calendar_feeds (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER,
  last_fetched_at INTEGER
);
CREATE INDEX idx_calendar_feeds_user ON calendar_feeds(tenant_id, user_id);

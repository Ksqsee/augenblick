-- Offene Punkte aus der Analyse: abgelehnte Offline-Übertragungen, selbstanpassende Prüfintervalle,
-- Partner-Zugang für Subunternehmer.

-- Abgelehnte Offline-Übertragungen bleiben auf dem Server, bis jemand sie erneut versucht oder löscht.
-- payload: Prüfungsdaten als JSON ohne Unterschrift (die liegt als Datei unter signature_key), größenbegrenzt;
-- NULL, wenn die Daten zu groß oder unlesbar waren. asset_id ist nur ein Verweis (Element kann gelöscht sein).
CREATE TABLE offline_failures (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  asset_id TEXT,
  asset_code TEXT NOT NULL DEFAULT '',
  client_id TEXT NOT NULL,
  status INTEGER NOT NULL,
  reason TEXT NOT NULL,
  payload TEXT,
  signature_key TEXT,
  attempts INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT REFERENCES users(id),
  inspection_id TEXT
);
CREATE UNIQUE INDEX ux_offline_failures_client ON offline_failures(tenant_id, user_id, client_id);
CREATE INDEX idx_offline_failures_open ON offline_failures(tenant_id, resolved_at, created_at);

-- Selbstanpassende Prüfintervalle: off | suggest | auto
ALTER TABLE tenants ADD COLUMN adapt_intervals_mode TEXT NOT NULL DEFAULT 'suggest';

-- Partner-Zugang: ein widerrufbarer Einladungscode je Subunternehmer; gespeichert wird nur der Hash
ALTER TABLE subcontractors ADD COLUMN partner_code_hash TEXT;
ALTER TABLE subcontractors ADD COLUMN partner_code_created_at INTEGER;
ALTER TABLE subcontractors ADD COLUMN partner_code_used_at INTEGER;
CREATE UNIQUE INDEX ux_subcontractors_partner_code ON subcontractors(partner_code_hash) WHERE partner_code_hash IS NOT NULL;

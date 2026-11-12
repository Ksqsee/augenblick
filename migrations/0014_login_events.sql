-- Anmeldeverlauf je Konto (erfolgreiche und fehlgeschlagene Anmeldungen), 90 Tage aufbewahrt
CREATE TABLE login_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  at INTEGER NOT NULL,
  success INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_login_events_user ON login_events(user_id, at);

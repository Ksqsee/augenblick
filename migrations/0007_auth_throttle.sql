-- Fehlversuche (Login, Passwort, Tokens, API-Schlüssel) für die Sperre gegen Durchprobieren.
-- ident ist ein Hash (IP-Adresse bzw. E-Mail werden nicht im Klartext gespeichert).
CREATE TABLE auth_throttle (
  scope TEXT NOT NULL,
  ident TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_auth_throttle ON auth_throttle(scope, ident, created_at);

-- OAuth 2.1 für den MCP-Server: Clients (dynamische Registrierung), Einmal-Codes und Tokens.
-- Tokens sind an einen API-Schlüssel gebunden und haben nie mehr Rechte als dieser; nur Hashes werden gespeichert.
CREATE TABLE oauth_clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(id),
  api_key_id TEXT NOT NULL REFERENCES api_keys(id),
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  client_id TEXT NOT NULL REFERENCES oauth_clients(id),
  api_key_id TEXT NOT NULL REFERENCES api_keys(id),
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_oauth_tokens_key ON oauth_tokens(api_key_id);
CREATE INDEX idx_oauth_tokens_expiry ON oauth_tokens(expires_at);

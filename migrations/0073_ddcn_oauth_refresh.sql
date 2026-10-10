CREATE TABLE IF NOT EXISTS ddcn_oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  scope TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  access_token_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ddcn_oauth_refresh_expiry ON ddcn_oauth_refresh_tokens(expires_at);
CREATE INDEX IF NOT EXISTS idx_ddcn_oauth_refresh_access ON ddcn_oauth_refresh_tokens(access_token_hash);

-- Independent OAuth storage; no changes to existing business tables.
CREATE TABLE IF NOT EXISTS ddcn_oauth_clients (
  client_id TEXT PRIMARY KEY,
  redirect_uri TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ddcn_oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  resource TEXT NOT NULL,
  scope TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ddcn_oauth_codes_expiry ON ddcn_oauth_codes(expires_at);
CREATE TABLE IF NOT EXISTS ddcn_oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  resource TEXT NOT NULL,
  scope TEXT NOT NULL,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ddcn_oauth_tokens_expiry ON ddcn_oauth_tokens(expires_at);

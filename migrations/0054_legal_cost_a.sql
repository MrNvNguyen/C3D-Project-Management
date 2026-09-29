-- Migration 0054: Chi phí A sidecar (override / spend / note) per payment_request
CREATE TABLE IF NOT EXISTS legal_cost_a (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payment_request_id INTEGER NOT NULL UNIQUE REFERENCES payment_requests(id) ON DELETE CASCADE,
  amount_override REAL NULL,
  spend_status TEXT NOT NULL DEFAULT 'unspent' CHECK(spend_status IN ('unspent', 'spent')),
  note TEXT,
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_legal_cost_a_payment ON legal_cost_a(payment_request_id);

-- ============================================================
-- Migration 0017: Web Push Subscriptions
-- Lưu subscription endpoint của từng browser/user
-- ============================================================

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL,
  endpoint     TEXT    NOT NULL,
  p256dh       TEXT    NOT NULL,
  auth         TEXT    NOT NULL,
  user_agent   TEXT,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, endpoint)
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user ON push_subscriptions(user_id);

-- Lưu VAPID keys vào system_config (nếu chưa có)
INSERT OR IGNORE INTO system_config (key, value, description)
VALUES
  ('vapid_public_key',  '', 'VAPID Public Key for Web Push'),
  ('vapid_private_key', '', 'VAPID Private Key for Web Push (secret)'),
  ('vapid_subject',     'mailto:admin@bimonecadvn.com', 'VAPID subject (contact email)');

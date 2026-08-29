-- Migration 0048: Notifications indexes for summary poll + retention
-- Hot path: GET /api/notifications/summary (unread COUNT + MAX id)
-- Retention: DELETE read notifications older than 90 days

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_id
  ON notifications(user_id, id DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_read_created
  ON notifications(is_read, created_at);

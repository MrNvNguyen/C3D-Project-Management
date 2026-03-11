-- Chat messages for tasks and projects
CREATE TABLE IF NOT EXISTS messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  context_type TEXT NOT NULL CHECK(context_type IN ('task','project')),
  context_id   INTEGER NOT NULL,
  sender_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content      TEXT NOT NULL,
  mentions     TEXT DEFAULT '[]',   -- JSON array of user_ids mentioned
  edited_at    DATETIME,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Attachments stored as base64 data (suitable for D1 / small files ≤ 2MB)
CREATE TABLE IF NOT EXISTS message_attachments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id  INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  file_name   TEXT NOT NULL,
  file_type   TEXT NOT NULL,   -- MIME type
  file_size   INTEGER DEFAULT 0,
  data        TEXT NOT NULL,   -- base64 encoded
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_messages_context ON messages(context_type, context_id);
CREATE INDEX IF NOT EXISTS idx_messages_sender  ON messages(sender_id);
CREATE INDEX IF NOT EXISTS idx_msg_attachments  ON message_attachments(message_id);

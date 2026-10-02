-- HSPL: lịch sử thay đổi (5 tab Thông tin / Hồ sơ / TT / Chi phí A / Contact)
CREATE TABLE IF NOT EXISTS legal_change_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  actor_user_id INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  area TEXT NOT NULL,
  entity_label TEXT NOT NULL,
  action TEXT NOT NULL,
  field TEXT,
  old_value TEXT,
  new_value TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_legal_change_logs_project_created
  ON legal_change_logs (project_id, created_at DESC);

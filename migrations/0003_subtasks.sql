-- ===================================================
-- Migration 0003: Subtasks table
-- ===================================================

CREATE TABLE IF NOT EXISTS subtasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,                        -- task cha
  title TEXT NOT NULL,                             -- tên subtask
  description TEXT,                                -- mô tả
  status TEXT NOT NULL DEFAULT 'todo',             -- todo | in_progress | done
  priority TEXT NOT NULL DEFAULT 'medium',         -- low | medium | high
  assigned_to INTEGER,                             -- có thể để null (tự làm)
  due_date DATE,
  estimated_hours REAL DEFAULT 0,
  actual_hours REAL DEFAULT 0,
  notes TEXT,                                      -- ghi chú / báo cáo của member
  created_by INTEGER NOT NULL,                     -- người tạo subtask
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_subtasks_task_id ON subtasks(task_id);
CREATE INDEX IF NOT EXISTS idx_subtasks_assigned_to ON subtasks(assigned_to);
CREATE INDEX IF NOT EXISTS idx_subtasks_status ON subtasks(status);

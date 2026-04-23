-- =====================================================
-- Migration 0031: Leave Requests (Book ngày nghỉ)
-- =====================================================

CREATE TABLE IF NOT EXISTS leave_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  leave_type      TEXT NOT NULL,           -- annual_leave | sick_leave | unpaid_leave | compensatory | holiday | half_day_am | half_day_pm
  start_date      DATE NOT NULL,
  end_date        DATE NOT NULL,
  total_days      REAL NOT NULL DEFAULT 1, -- 0.5 cho half_day
  reason          TEXT,
  status          TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected
  reviewed_by     INTEGER,                -- system_admin user_id
  reviewed_at     DATETIME,
  review_note     TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)     REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_leave_requests_user_id    ON leave_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_status     ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_start_date ON leave_requests(start_date);
CREATE INDEX IF NOT EXISTS idx_leave_requests_end_date   ON leave_requests(end_date);

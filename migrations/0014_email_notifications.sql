-- ============================================================
-- Migration 0014: Email Notifications
-- Bảng cài đặt email của từng user + log gửi email
-- ============================================================

-- Cài đặt thông báo email của từng user
CREATE TABLE IF NOT EXISTS email_settings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL UNIQUE,
  -- Bật/tắt toàn bộ email
  email_enabled INTEGER DEFAULT 1,
  -- Từng loại sự kiện
  notify_task_assigned    INTEGER DEFAULT 1,  -- Được giao task mới
  notify_task_updated     INTEGER DEFAULT 1,  -- Task được cập nhật (status, deadline...)
  notify_task_overdue     INTEGER DEFAULT 1,  -- Task quá hạn
  notify_project_added    INTEGER DEFAULT 1,  -- Được thêm vào dự án
  notify_project_updated  INTEGER DEFAULT 0,  -- Dự án được cập nhật
  notify_timesheet_approved INTEGER DEFAULT 1, -- Timesheet được duyệt/từ chối
  notify_payment_request  INTEGER DEFAULT 1,  -- Có đề nghị thanh toán mới (admin)
  notify_chat_mention     INTEGER DEFAULT 1,  -- Được @mention trong chat
  notify_daily_digest     INTEGER DEFAULT 0,  -- Tóm tắt hàng ngày (future)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Log lịch sử gửi email
CREATE TABLE IF NOT EXISTS email_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  event_type TEXT NOT NULL,  -- task_assigned, task_updated, ...
  related_type TEXT,
  related_id   INTEGER,
  status     TEXT DEFAULT 'sent',  -- sent | failed
  error_msg  TEXT,
  sent_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Index tìm kiếm nhanh
CREATE INDEX IF NOT EXISTS idx_email_settings_user ON email_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_user     ON email_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at  ON email_logs(sent_at);

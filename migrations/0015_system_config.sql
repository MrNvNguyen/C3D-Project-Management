-- System configuration table (lưu cấu hình toàn hệ thống)
CREATE TABLE IF NOT EXISTS system_config (
  key TEXT PRIMARY KEY,
  value TEXT,
  description TEXT,
  updated_by INTEGER,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed default config
INSERT OR IGNORE INTO system_config (key, value, description) VALUES
  ('resend_api_key', '', 'Resend API Key cho Email Notifications'),
  ('email_from_name', 'OneCad BIM', 'Tên hiển thị khi gửi email'),
  ('email_from_address', 'onboarding@resend.dev', 'Địa chỉ email gửi đi'),
  ('email_enabled', '1', 'Bật/tắt tính năng email toàn hệ thống');

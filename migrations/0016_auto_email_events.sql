-- ============================================================
-- Migration 0016: Auto Email Events
-- Mở rộng email_settings với các sự kiện mới
-- Thêm cột notify_project_created, notify_payment_status
-- ============================================================

-- Thêm cột notify_project_created vào email_settings (nếu chưa có)
ALTER TABLE email_settings ADD COLUMN notify_project_created INTEGER DEFAULT 1;

-- Thêm cột notify_payment_status (khi thanh toán được cập nhật trạng thái)
ALTER TABLE email_settings ADD COLUMN notify_payment_status INTEGER DEFAULT 1;

-- Thêm cột notify_member_added (khi có thành viên mới thêm vào dự án → thông báo cho PM)
ALTER TABLE email_settings ADD COLUMN notify_member_added INTEGER DEFAULT 0;

-- Index hỗ trợ truy vấn email_logs theo event_type
CREATE INDEX IF NOT EXISTS idx_email_logs_event_type ON email_logs(event_type);
CREATE INDEX IF NOT EXISTS idx_email_logs_related ON email_logs(related_type, related_id);

-- ===================================================
-- Migration 0011: Liên kết payment_requests ↔ project_revenues
-- Khi đợt thanh toán có trạng thái paid/partial
-- → tự động tạo bản ghi doanh thu tương ứng
-- ===================================================

-- Thêm cột revenue_id vào payment_requests để tracking
ALTER TABLE payment_requests ADD COLUMN revenue_id INTEGER REFERENCES project_revenues(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_requests_revenue ON payment_requests(revenue_id);

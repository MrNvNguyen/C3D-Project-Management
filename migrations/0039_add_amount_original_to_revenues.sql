-- Migration 0039: Thêm cột amount_original vào project_revenues
-- amount_original = Giá trị nghiệm thu gốc (từ payment_requests.amount)
-- amount          = Doanh thu NS (sau VAT + phí QL) — giữ nguyên để không ảnh hưởng code cũ

ALTER TABLE project_revenues ADD COLUMN amount_original REAL DEFAULT 0;

-- Backfill: với các bản ghi hiện tại chưa có amount_original,
-- lấy từ payment_requests.amount nếu có, fallback = amount (doanh thu NS)
UPDATE project_revenues
SET amount_original = COALESCE(
  (SELECT pq.amount FROM payment_requests pq WHERE pq.revenue_id = project_revenues.id LIMIT 1),
  amount
)
WHERE amount_original IS NULL OR amount_original = 0;

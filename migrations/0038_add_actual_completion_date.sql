-- ===================================================
-- Migration 0038: Thêm cột actual_completion_date vào legal_items
-- Ngày hoàn thành thực tế (ngày ký HĐ, ngày nghiệm thu...)
-- ===================================================

ALTER TABLE legal_items ADD COLUMN actual_completion_date DATE;

-- Ghi chú:
-- actual_completion_date: ngày thực tế hoàn thành hạng mục
-- (ngày ký hợp đồng, ngày nghiệm thu, ngày bàn giao...)
-- Khác với due_date (hạn thực hiện theo kế hoạch)

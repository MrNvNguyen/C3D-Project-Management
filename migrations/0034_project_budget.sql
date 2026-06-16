-- Thêm % chi phí quản lý và ngân sách thực tế dự án
ALTER TABLE projects ADD COLUMN management_fee_pct REAL DEFAULT 0;
-- project_budget = contract_value * (1 - management_fee_pct/100)
-- Được tính động ở backend, không lưu DB để tránh inconsistency

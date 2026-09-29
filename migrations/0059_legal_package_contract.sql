-- Hợp đồng / gói thầu trên Thông tin dự án: mã, thời hạn, giá trị.
-- Tab Theo dõi hồ sơ dùng cùng bảng legal_packages.

ALTER TABLE legal_packages ADD COLUMN code TEXT;
ALTER TABLE legal_packages ADD COLUMN start_date TEXT;
ALTER TABLE legal_packages ADD COLUMN end_date TEXT;
ALTER TABLE legal_packages ADD COLUMN contract_value REAL DEFAULT 0;

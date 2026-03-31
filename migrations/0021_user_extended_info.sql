-- Migration 0021: Bổ sung thêm thông tin nhân sự mở rộng

-- CCCD mở rộng
ALTER TABLE users ADD COLUMN cccd_issue_date TEXT;        -- Ngày cấp CCCD
ALTER TABLE users ADD COLUMN cccd_issue_place TEXT;       -- Nơi cấp CCCD

-- Thông tin cá nhân
ALTER TABLE users ADD COLUMN gender TEXT;                 -- Giới tính: male/female/other
ALTER TABLE users ADD COLUMN join_date TEXT;              -- Ngày vào công ty
ALTER TABLE users ADD COLUMN job_title TEXT;              -- Chức danh

-- Bảo hiểm & thuế
ALTER TABLE users ADD COLUMN social_insurance_number TEXT; -- Mã số BHXH
ALTER TABLE users ADD COLUMN tax_number TEXT;              -- Mã số thuế cá nhân (MST)

-- Thông tin ngân hàng
ALTER TABLE users ADD COLUMN bank_account TEXT;           -- Số tài khoản ngân hàng
ALTER TABLE users ADD COLUMN bank_name TEXT;              -- Tên ngân hàng
ALTER TABLE users ADD COLUMN bank_branch TEXT;            -- Chi nhánh ngân hàng

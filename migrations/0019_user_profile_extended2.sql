-- Migration 0019: Thêm thông tin học vấn và nơi ở hiện tại
ALTER TABLE users ADD COLUMN current_address TEXT;
ALTER TABLE users ADD COLUMN major TEXT;
ALTER TABLE users ADD COLUMN university TEXT;
ALTER TABLE users ADD COLUMN graduation_year INTEGER;

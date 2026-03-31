-- Migration 0018: Thêm các trường mở rộng cho hồ sơ cá nhân
ALTER TABLE users ADD COLUMN cccd TEXT;
ALTER TABLE users ADD COLUMN birthday TEXT;
ALTER TABLE users ADD COLUMN address TEXT;

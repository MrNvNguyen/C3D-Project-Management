-- Migration 0020: Tạo bảng departments và thêm cột degree vào users

-- Bảng phòng ban/bộ môn do Admin quản lý
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Seed dữ liệu mặc định từ các giá trị hardcode cũ
INSERT OR IGNORE INTO departments (name, sort_order) VALUES
  ('BIM/Design', 1),
  ('Kiến trúc', 2),
  ('Kết cấu', 3),
  ('MEP', 4),
  ('Hạ tầng', 5),
  ('Quản lý dự án', 6),
  ('Support', 7),
  ('Quản lý hệ thống', 8);

-- Thêm cột trình độ vào users
ALTER TABLE users ADD COLUMN degree TEXT;

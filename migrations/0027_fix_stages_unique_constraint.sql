-- Migration 0027: Sửa UNIQUE constraint của legal_stages
-- Thay UNIQUE(project_id, code) thành UNIQUE(package_id, code)
-- Vì mỗi package đều có các giai đoạn A-B-C-D riêng
-- nên cùng 1 project có thể có nhiều stage cùng code A/B/C/D (khác package)

-- SQLite không hỗ trợ DROP CONSTRAINT trực tiếp
-- Cần tạo lại bảng

-- 1. Tạo bảng mới không có UNIQUE(project_id, code)
CREATE TABLE IF NOT EXISTS legal_stages_new (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  package_id  INTEGER REFERENCES legal_packages(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,
  name        TEXT NOT NULL,
  sort_order  INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(package_id, code)
);

-- 2. Copy dữ liệu cũ
INSERT INTO legal_stages_new (id, project_id, package_id, code, name, sort_order, created_at)
SELECT id, project_id, package_id, code, name, sort_order, created_at
FROM legal_stages;

-- 3. Drop bảng cũ
DROP TABLE legal_stages;

-- 4. Rename bảng mới
ALTER TABLE legal_stages_new RENAME TO legal_stages;

-- 5. Tạo lại indexes
CREATE INDEX IF NOT EXISTS idx_legal_stages_project ON legal_stages(project_id);
CREATE INDEX IF NOT EXISTS idx_legal_stages_package ON legal_stages(package_id);

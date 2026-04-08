-- Migration 0026: Thêm bảng legal_packages (Gói thầu)
-- Cấu trúc mới: Gói thầu → 4 giai đoạn A-B-C-D → hạng mục
--
-- Một dự án có thể có 1, 2 hoặc 3 gói thầu tùy phân bổ:
--   - 3 gói: BCNCKT | TKBVTC (GĐTK) | Thi công & Hoàn công
--   - 2 gói: BCNCKT | TKBVTC + Thi công & Hoàn công
--   - 1 gói: Tổng hợp toàn bộ
-- Mỗi gói thầu đều có 4 giai đoạn cố định A-B-C-D:
--   A: Chuẩn bị & Dự thầu
--   B: Ký hợp đồng
--   C: Thực hiện (Sản phẩm BIM)
--   D: Nghiệm thu & Thanh toán

CREATE TABLE IF NOT EXISTS legal_packages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,        -- VD: "Gói BCNCKT", "Gói TKBVTC", "Gói Thi công & Hoàn công"
  package_type TEXT DEFAULT 'custom', -- 'bcnckt' | 'tkbvtc' | 'construction' | 'custom'
  sort_order  INTEGER DEFAULT 0,
  notes       TEXT,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Thêm cột package_id vào legal_stages (NULL = stage cũ chưa có package)
ALTER TABLE legal_stages ADD COLUMN package_id INTEGER REFERENCES legal_packages(id) ON DELETE CASCADE;

-- Index
CREATE INDEX IF NOT EXISTS idx_legal_packages_project ON legal_packages(project_id);
CREATE INDEX IF NOT EXISTS idx_legal_stages_package   ON legal_stages(package_id);

-- Migrate dữ liệu cũ: tạo 1 package mặc định "Gói thầu tổng hợp" cho mỗi project
-- đang có stages cũ (package_id IS NULL), sau đó gán package_id cho các stage đó.
-- (Thực hiện qua API /api/legal/migrate-packages sau khi deploy)

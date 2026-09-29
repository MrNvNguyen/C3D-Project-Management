-- Loại chi phí: GET /api/costs JOIN bảng này. Trước đó bảng chỉ được tạo trong /api/system/init.
CREATE TABLE IF NOT EXISTS cost_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  color TEXT DEFAULT '#6B7280',
  is_active INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0
);

INSERT OR IGNORE INTO cost_types (code, name, description, color, sort_order) VALUES
  ('salary', 'Chi phí lương', 'Chi phí lương và phúc lợi nhân sự', '#00A651', 1),
  ('material', 'Chi phí vật liệu', 'Vật tư, nguyên liệu thi công', '#0066CC', 2),
  ('equipment', 'Chi phí thiết bị', 'Thuê hoặc khấu hao thiết bị', '#8B5CF6', 3),
  ('transport', 'Chi phí vận chuyển', 'Di chuyển, vận chuyển hàng hóa', '#FF6B00', 4),
  ('other', 'Chi phí khác', 'Các chi phí phát sinh khác', '#6B7280', 5);

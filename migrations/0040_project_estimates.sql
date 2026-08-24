-- Bảng dự toán chi phí và doanh thu cho từng dự án
-- Mỗi dự án có nhiều dòng dự toán, mỗi dòng là 1 hạng mục
-- category: 'revenue' | 'direct_cost' | 'labor' | 'shared' | 'other'
CREATE TABLE IF NOT EXISTS project_estimates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL,
  category     TEXT    NOT NULL DEFAULT 'direct_cost',
  -- Tên hạng mục dự toán (VD: "Khảo sát địa hình", "CP nhân công TKCS"...)
  description  TEXT    NOT NULL,
  amount       REAL    NOT NULL DEFAULT 0,
  unit         TEXT,          -- đơn vị: "đồng", "%" ...
  notes        TEXT,
  sort_order   INTEGER DEFAULT 0,
  created_by   INTEGER,
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_estimates_project ON project_estimates(project_id);

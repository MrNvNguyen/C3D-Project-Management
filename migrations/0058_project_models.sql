-- Danh sách model của dự án. Trước đây chỉ tạo trong POST /api/system/init.
CREATE TABLE IF NOT EXISTS project_models (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_project_models_proj ON project_models(project_id);

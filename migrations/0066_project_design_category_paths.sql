-- QLy HSTK: folder path per hạng mục (category) within a discipline
CREATE TABLE IF NOT EXISTS project_design_category_paths (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  discipline_code TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  folder_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  UNIQUE (project_id, discipline_code, category_id)
);

CREATE INDEX IF NOT EXISTS idx_pdcp_project_disc ON project_design_category_paths(project_id, discipline_code);

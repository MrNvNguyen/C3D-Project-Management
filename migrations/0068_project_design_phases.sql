-- QLy HSTK: giai đoạn (sheet) + bộ môn theo giai đoạn
CREATE TABLE IF NOT EXISTS project_design_phases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE (project_id, code)
);

CREATE INDEX IF NOT EXISTS idx_pdp_project ON project_design_phases(project_id);

CREATE TABLE IF NOT EXISTS project_design_disciplines_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  phase_id INTEGER,
  discipline_code TEXT NOT NULL,
  role_codes TEXT NOT NULL DEFAULT '',
  leader_id INTEGER,
  folder_path TEXT,
  last_scanned_at DATETIME,
  last_scanned_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (phase_id) REFERENCES project_design_phases(id) ON DELETE RESTRICT,
  UNIQUE (project_id, phase_id, discipline_code)
);

INSERT INTO project_design_disciplines_v2 (
  id, project_id, phase_id, discipline_code, role_codes, leader_id, folder_path,
  last_scanned_at, last_scanned_by, created_at, updated_at
)
SELECT
  id, project_id, NULL, discipline_code, role_codes, leader_id, folder_path,
  last_scanned_at, last_scanned_by, created_at, updated_at
FROM project_design_disciplines;

DROP TABLE project_design_disciplines;
ALTER TABLE project_design_disciplines_v2 RENAME TO project_design_disciplines;

CREATE INDEX IF NOT EXISTS idx_pdd_project ON project_design_disciplines(project_id);
CREATE INDEX IF NOT EXISTS idx_pdd_project_phase ON project_design_disciplines(project_id, phase_id);

CREATE TABLE IF NOT EXISTS project_design_category_paths_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  phase_id INTEGER,
  discipline_code TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  folder_path TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
  FOREIGN KEY (phase_id) REFERENCES project_design_phases(id) ON DELETE RESTRICT,
  UNIQUE (project_id, phase_id, discipline_code, category_id)
);

INSERT INTO project_design_category_paths_v2 (
  id, project_id, phase_id, discipline_code, category_id, folder_path, created_at, updated_at
)
SELECT id, project_id, NULL, discipline_code, category_id, folder_path, created_at, updated_at
FROM project_design_category_paths;

DROP TABLE project_design_category_paths;
ALTER TABLE project_design_category_paths_v2 RENAME TO project_design_category_paths;

CREATE INDEX IF NOT EXISTS idx_pdcp_project_disc ON project_design_category_paths(project_id, discipline_code);
CREATE INDEX IF NOT EXISTS idx_pdcp_project_phase ON project_design_category_paths(project_id, phase_id);

ALTER TABLE design_scan_tokens ADD COLUMN phase_id INTEGER;

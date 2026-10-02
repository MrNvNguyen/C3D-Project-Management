-- QLy HSTK: bộ môn, gói hồ sơ thiết kế, quét folder, token một lần
CREATE TABLE IF NOT EXISTS project_design_disciplines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  discipline_code TEXT NOT NULL,
  role_codes TEXT NOT NULL DEFAULT '',
  leader_id INTEGER,
  folder_path TEXT,
  last_scanned_at DATETIME,
  last_scanned_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE (project_id, discipline_code)
);

CREATE INDEX IF NOT EXISTS idx_pdd_project ON project_design_disciplines(project_id);

CREATE TABLE IF NOT EXISTS design_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  discipline_code TEXT NOT NULL,
  folder_name TEXT NOT NULL,
  package_date DATE NOT NULL,
  description TEXT,
  first_seen_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  created_by INTEGER,
  missing_since DATETIME,
  package_type TEXT DEFAULT 'issue',
  doc_stage TEXT DEFAULT 'TKCS',
  revision_label TEXT,
  review_status TEXT DEFAULT 'pending',
  review_due_date DATE,
  source TEXT DEFAULT 'internal',
  outgoing_letter_id INTEGER,
  updated_by INTEGER,
  updated_at DATETIME,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE (project_id, discipline_code, folder_name)
);

CREATE INDEX IF NOT EXISTS idx_design_pkg_proj_disc ON design_packages(project_id, discipline_code);
CREATE INDEX IF NOT EXISTS idx_design_pkg_date ON design_packages(project_id, discipline_code, package_date);

CREATE TABLE IF NOT EXISTS design_scan_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  discipline_code TEXT NOT NULL,
  scanned_by INTEGER,
  scanned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  new_count INTEGER DEFAULT 0,
  missing_count INTEGER DEFAULT 0,
  total_count INTEGER DEFAULT 0,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_design_scan_log_proj ON design_scan_log(project_id, discipline_code, scanned_at DESC);

CREATE TABLE IF NOT EXISTS design_scan_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  discipline_code TEXT NOT NULL,
  mode TEXT NOT NULL,
  expires_at DATETIME NOT NULL,
  used_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_design_scan_tokens_hash ON design_scan_tokens(token_hash);

ALTER TABLE tasks ADD COLUMN design_package_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_tasks_design_package ON tasks(design_package_id);

ALTER TABLE email_settings ADD COLUMN notify_design_package INTEGER DEFAULT 1;

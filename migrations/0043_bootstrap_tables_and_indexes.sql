-- Formalize tables previously created only by POST /api/system/init
-- and add indexes used by finance / timesheet / notification queries.

CREATE TABLE IF NOT EXISTS timesheet_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  timesheet_id INTEGER NOT NULL,
  task_id INTEGER,
  regular_hours REAL DEFAULT 0,
  overtime_hours REAL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (timesheet_id) REFERENCES timesheets(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_timesheet_tasks_ts ON timesheet_tasks(timesheet_id);
CREATE INDEX IF NOT EXISTS idx_timesheet_tasks_task ON timesheet_tasks(task_id);

CREATE TABLE IF NOT EXISTS monthly_labor_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  total_labor_cost REAL NOT NULL,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(month, year)
);
CREATE INDEX IF NOT EXISTS idx_mlc_year_month ON monthly_labor_costs(year, month);

CREATE TABLE IF NOT EXISTS project_labor_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  total_labor_cost REAL NOT NULL DEFAULT 0,
  total_hours REAL NOT NULL DEFAULT 0,
  cost_per_hour REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, month, year),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_plc_project_year ON project_labor_costs(project_id, year, month);

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS shared_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  description TEXT NOT NULL,
  cost_type TEXT NOT NULL DEFAULT 'other',
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'VND',
  cost_date DATE,
  invoice_number TEXT,
  vendor TEXT,
  notes TEXT,
  allocation_basis TEXT NOT NULL DEFAULT 'contract_value',
  year INTEGER,
  month INTEGER,
  status TEXT DEFAULT 'active',
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_shared_costs_year_month ON shared_costs(year, month);

CREATE TABLE IF NOT EXISTS shared_cost_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shared_cost_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  allocated_amount REAL NOT NULL DEFAULT 0,
  allocation_pct REAL NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(shared_cost_id, project_id),
  FOREIGN KEY (shared_cost_id) REFERENCES shared_costs(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sca_project ON shared_cost_allocations(project_id);

-- timesheets.category_id (0028 was skipped)
-- SQLite has no IF NOT EXISTS for columns; ignore duplicate-column errors at apply time via wrangler.
-- Fresh DBs: add column. Existing DBs that already have it: this statement may fail.
-- Use a no-op friendly pattern: create index only if column exists after a guarded alter in app is not needed
-- because production already has the column from init. Fresh migrate from 0001 needs the column.

-- Indexes on existing high-traffic tables
CREATE INDEX IF NOT EXISTS idx_project_costs_project_date ON project_costs(project_id, cost_date);
CREATE INDEX IF NOT EXISTS idx_project_revenues_project_date ON project_revenues(project_id, revenue_date);
CREATE INDEX IF NOT EXISTS idx_categories_project ON categories(project_id);
CREATE INDEX IF NOT EXISTS idx_task_history_task ON task_history(task_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_read ON notifications(user_id, is_read);

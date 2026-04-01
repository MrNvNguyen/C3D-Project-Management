-- Migration 0022: Fix timesheets UNIQUE constraint
-- Change UNIQUE(user_id, work_date) → UNIQUE(user_id, project_id, work_date)
-- This allows one person to log hours for multiple projects on the same date (bulk-import use case)

-- Step 1: Create new table with correct UNIQUE constraint
CREATE TABLE IF NOT EXISTS timesheets_v2 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER,
  task_id INTEGER,
  work_date DATE NOT NULL,
  day_type TEXT NOT NULL DEFAULT 'work',
  regular_hours REAL DEFAULT 0,
  overtime_hours REAL DEFAULT 0,
  description TEXT,
  status TEXT DEFAULT 'draft',
  approved_by INTEGER,
  approved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, project_id, work_date)
);

-- Step 2: Copy all data (duplicates on new key are ignored, keep first)
INSERT OR IGNORE INTO timesheets_v2
  (id, user_id, project_id, task_id, work_date, day_type,
   regular_hours, overtime_hours, description, status,
   approved_by, approved_at, created_at, updated_at)
SELECT id, user_id, project_id, task_id, work_date,
  COALESCE(day_type, 'work'), regular_hours, overtime_hours,
  description, status, approved_by, approved_at, created_at, updated_at
FROM timesheets;

-- Step 3: Drop old table and rename
DROP TABLE timesheets;
ALTER TABLE timesheets_v2 RENAME TO timesheets;

-- Step 4: Recreate indexes
CREATE INDEX IF NOT EXISTS idx_timesheets_user_date ON timesheets(user_id, work_date);
CREATE INDEX IF NOT EXISTS idx_timesheets_project ON timesheets(project_id);

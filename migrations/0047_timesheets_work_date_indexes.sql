-- Wave 3: recreate work_date index dropped in 0022; composite for project+date labor/list.
-- Authorized after Wave 1–2 rewrite: company-wide and project+date range still SCAN without these.
CREATE INDEX IF NOT EXISTS idx_timesheets_work_date ON timesheets(work_date);
CREATE INDEX IF NOT EXISTS idx_timesheets_project_work_date ON timesheets(project_id, work_date);

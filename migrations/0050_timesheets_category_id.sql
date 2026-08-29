-- timesheets.category_id was skipped in 0028; init ALTER may have added it on some DBs.
-- Additive for local/fresh DBs missing the column. Skip apply if column already exists.
ALTER TABLE timesheets ADD COLUMN category_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_timesheets_category ON timesheets(category_id);

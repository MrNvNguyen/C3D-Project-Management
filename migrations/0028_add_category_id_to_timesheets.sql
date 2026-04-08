-- Migration 0028: Add category_id column to timesheets table (SKIPPED)
-- This migration is skipped because category_id column may already exist on production
-- If you need to add this column, check your schema first

-- IMPORTANT: This migration does nothing to avoid duplicate column errors
-- The column may have been added manually or via another migration

-- If running on a fresh database, you may need to manually add:
-- ALTER TABLE timesheets ADD COLUMN category_id INTEGER;
-- CREATE INDEX IF NOT EXISTS idx_timesheets_category ON timesheets(category_id);

SELECT 'Migration 0028: Skipped (category_id may already exist)' as message;

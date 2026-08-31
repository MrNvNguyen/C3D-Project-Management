-- Migration 0049: tasks extended columns (SKIPPED as DDL)
-- Production already has task_type / model_filename / cde_report / work_notes / hstk_date
-- from historical POST /system/init ALTER — ADD COLUMN fails with duplicate column name.
-- Same pattern as 0028 (timesheets.category_id).
--
-- Fresh DB without these columns: add manually (one statement at a time; skip if duplicate):
--   ALTER TABLE tasks ADD COLUMN task_type TEXT DEFAULT 'model';
--   ALTER TABLE tasks ADD COLUMN model_filename TEXT;
--   ALTER TABLE tasks ADD COLUMN cde_report INTEGER DEFAULT 0;
--   ALTER TABLE tasks ADD COLUMN work_notes TEXT;
--   ALTER TABLE tasks ADD COLUMN hstk_date DATE;

SELECT 'Migration 0049: Skipped (tasks extended columns may already exist via init)' AS message;

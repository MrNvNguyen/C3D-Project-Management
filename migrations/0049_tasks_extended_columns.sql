-- Additive columns previously only added via POST /system/init ALTER.
-- Safe on DBs missing these columns. If a column already exists, this migration fails for that statement — apply manually / skip on already-inited DBs.
ALTER TABLE tasks ADD COLUMN task_type TEXT DEFAULT 'model';
ALTER TABLE tasks ADD COLUMN model_filename TEXT;
ALTER TABLE tasks ADD COLUMN cde_report INTEGER DEFAULT 0;
ALTER TABLE tasks ADD COLUMN work_notes TEXT;
ALTER TABLE tasks ADD COLUMN hstk_date DATE;

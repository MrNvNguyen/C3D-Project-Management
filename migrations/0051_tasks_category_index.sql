-- Index for GET /api/projects/:id/categories pre-agg and category delete guard.
CREATE INDEX IF NOT EXISTS idx_tasks_category ON tasks(category_id);

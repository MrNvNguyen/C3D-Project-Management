-- One leave row per user per day (project_id IS NULL). Work rows keep
-- UNIQUE(user_id, project_id, work_date) from migration 0022.

-- Keep newest leave row per user/day so the unique index can apply.
DELETE FROM timesheets
WHERE id IN (
  SELECT id FROM (
    SELECT t.id
    FROM timesheets t
    WHERE t.project_id IS NULL
      AND t.id NOT IN (
        SELECT MAX(t2.id)
        FROM timesheets t2
        WHERE t2.project_id IS NULL
        GROUP BY t2.user_id, t2.work_date
      )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_timesheets_leave_day
  ON timesheets(user_id, work_date)
  WHERE project_id IS NULL;

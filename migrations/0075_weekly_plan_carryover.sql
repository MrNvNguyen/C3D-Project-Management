-- Việc chưa xong được chuyển sang tuần sau; mỗi nguồn chỉ chuyển một lần trong một kế hoạch.
ALTER TABLE weekly_plan_items ADD COLUMN carried_from_item_id INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_weekly_plan_items_carried
  ON weekly_plan_items(plan_id, carried_from_item_id)
  WHERE carried_from_item_id IS NOT NULL;

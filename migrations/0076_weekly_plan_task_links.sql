-- Map người phụ trách → task tạo từ kế hoạch tuần, để leader giao lại đúng task.
ALTER TABLE weekly_plan_items ADD COLUMN linked_task_ids TEXT;

-- Migration 0036: Add is_custom + created_by to checklist_submission_items
-- is_custom = 1  → hồ sơ bổ sung do người dùng thêm tay (có thể xoá)
-- is_custom = 0  → hồ sơ sinh tự động từ template (không xoá được)

ALTER TABLE checklist_submission_items ADD COLUMN is_custom INTEGER DEFAULT 0;
ALTER TABLE checklist_submission_items ADD COLUMN created_by INTEGER REFERENCES users(id);

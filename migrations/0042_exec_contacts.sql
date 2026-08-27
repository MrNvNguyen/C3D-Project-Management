-- ===================================================
-- Migration 0042: Bổ sung đầu mối liên hệ dự án cho Executive Dashboard
-- TVTK (Tư vấn thiết kế), QLDA (Quản lý dự án), CĐT (Chủ đầu tư), Nhà thầu
-- ===================================================

ALTER TABLE project_health ADD COLUMN tvtk_name    TEXT;
ALTER TABLE project_health ADD COLUMN tvtk_contact TEXT;
ALTER TABLE project_health ADD COLUMN tvtk_phone   TEXT;

ALTER TABLE project_health ADD COLUMN qlda_name    TEXT;
ALTER TABLE project_health ADD COLUMN qlda_contact TEXT;
ALTER TABLE project_health ADD COLUMN qlda_phone   TEXT;

ALTER TABLE project_health ADD COLUMN cdt_name     TEXT;
ALTER TABLE project_health ADD COLUMN cdt_contact  TEXT;
ALTER TABLE project_health ADD COLUMN cdt_phone    TEXT;

ALTER TABLE project_health ADD COLUMN nthau_name    TEXT;
ALTER TABLE project_health ADD COLUMN nthau_contact TEXT;
ALTER TABLE project_health ADD COLUMN nthau_phone   TEXT;

ALTER TABLE project_health ADD COLUMN major_issues TEXT;

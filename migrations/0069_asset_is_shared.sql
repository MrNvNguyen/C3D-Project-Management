-- Tài sản dùng chung (không gán một nhân sự). Xuất Excel: Người giữ = "Dùng chung của phòng".
ALTER TABLE assets ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0;

-- Migration: Thêm bảng quản lý Biên bản họp
-- Tạo: 2026-04-09
-- Mục đích: Quản lý biên bản họp dự án tương tự Văn bản gửi đi

CREATE TABLE IF NOT EXISTS meeting_minutes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  legal_item_id INTEGER,  -- Có thể liên kết với một hạng mục trong hồ sơ pháp lý
  
  -- Thông tin cơ bản
  meeting_number TEXT,  -- Số biên bản (tự động hoặc thủ công)
  meeting_date DATE NOT NULL,  -- Ngày họp
  meeting_time TEXT,  -- Giờ họp (VD: "09:00 - 11:30")
  location TEXT,  -- Địa điểm họp
  subject TEXT NOT NULL,  -- Chủ đề/tiêu đề cuộc họp
  
  -- Người tham gia
  chair_person TEXT,  -- Chủ trì
  secretary TEXT,  -- Thư ký
  attendees TEXT,  -- Danh sách người tham dự (JSON array hoặc comma-separated)
  absent_members TEXT,  -- Người vắng mặt
  
  -- Nội dung
  agenda TEXT,  -- Chương trình/nội dung cuộc họp
  discussion TEXT,  -- Nội dung thảo luận
  decisions TEXT,  -- Quyết định/kết luận
  action_items TEXT,  -- Công việc cần làm (JSON array)
  
  -- Tài liệu đính kèm
  attachments TEXT,  -- JSON array: [{ name, url, size, type }]
  
  -- Trạng thái
  status TEXT DEFAULT 'draft',  -- draft, finalized, approved
  notes TEXT,  -- Ghi chú thêm
  
  -- Audit
  created_by INTEGER NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (legal_item_id) REFERENCES legal_items(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

-- Index để tăng tốc query
CREATE INDEX IF NOT EXISTS idx_meeting_minutes_project ON meeting_minutes(project_id);
CREATE INDEX IF NOT EXISTS idx_meeting_minutes_date ON meeting_minutes(meeting_date);
CREATE INDEX IF NOT EXISTS idx_meeting_minutes_status ON meeting_minutes(status);
CREATE INDEX IF NOT EXISTS idx_meeting_minutes_legal_item ON meeting_minutes(legal_item_id);

-- Bảng cấu hình tự động đánh số biên bản họp (tùy chọn)
CREATE TABLE IF NOT EXISTS meeting_minutes_config (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL UNIQUE,
  prefix TEXT DEFAULT 'BB',  -- Tiền tố: BB (Biên bản)
  include_project_code INTEGER DEFAULT 1,  -- Có bao gồm mã dự án không
  seq_reset_yearly INTEGER DEFAULT 1,  -- Reset số thứ tự theo năm
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

-- Index
CREATE INDEX IF NOT EXISTS idx_meeting_config_project ON meeting_minutes_config(project_id);

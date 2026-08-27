-- ===================================================
-- Migration 0041: Executive PMO Dashboard
-- Bảng sức khỏe dự án & chỉ đạo lãnh đạo
-- ===================================================

-- Bảng sức khỏe dự án (health score, risk level, client contact, phase info)
CREATE TABLE IF NOT EXISTS project_health (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id          INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  -- Sức khỏe tổng thể (0-100)
  health_score        INTEGER DEFAULT 50,
  -- Mức độ rủi ro: low | medium | high | critical
  risk_level          TEXT DEFAULT 'medium',
  -- Giai đoạn đang triển khai hiện tại
  current_phase       TEXT,
  -- Mốc kế tiếp cần đạt
  next_milestone      TEXT,
  next_milestone_date DATE,
  -- Báo cáo PM mới nhất
  pm_report           TEXT,
  pm_report_date      DATE,
  -- Rủi ro / điểm nghẽn
  risk_notes          TEXT,
  -- Thông tin đầu mối khách hàng
  client_contact_name  TEXT,
  client_contact_title TEXT,
  client_contact_phone TEXT,
  -- PM phụ trách
  pm_name             TEXT,
  pm_title            TEXT,
  pm_phone            TEXT,
  -- Số đợt thanh toán tiếp theo
  next_payment_phase  TEXT,
  next_payment_amount REAL DEFAULT 0,
  next_payment_note   TEXT,
  -- Cập nhật bởi
  updated_by          INTEGER REFERENCES users(id),
  created_at          DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_project_health_project ON project_health(project_id);
CREATE INDEX IF NOT EXISTS idx_project_health_risk    ON project_health(risk_level);

-- Bảng chỉ đạo của sếp (Boss Directives)
CREATE TABLE IF NOT EXISTS boss_directives (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Nội dung chỉ đạo
  content     TEXT NOT NULL,
  -- Người nhận chỉ đạo (PM hoặc nhân sự cụ thể)
  assignee_id INTEGER REFERENCES users(id),
  assignee_name TEXT,
  -- Trạng thái: open | in_progress | done
  status      TEXT DEFAULT 'open',
  -- Ưu tiên: low | medium | high | urgent
  priority    TEXT DEFAULT 'high',
  -- Deadline thực hiện chỉ đạo
  due_date    DATE,
  -- Ghi chú phản hồi
  response    TEXT,
  responded_at DATETIME,
  responded_by INTEGER REFERENCES users(id),
  -- Người tạo (thường là admin/sếp)
  created_by  INTEGER REFERENCES users(id),
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_boss_directives_project ON boss_directives(project_id);
CREATE INDEX IF NOT EXISTS idx_boss_directives_status  ON boss_directives(status);
CREATE INDEX IF NOT EXISTS idx_boss_directives_created ON boss_directives(created_at DESC);

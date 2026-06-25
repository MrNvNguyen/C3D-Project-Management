-- ============================================================
-- CHECKLIST HỒ SƠ THIẾT KẾ (HSTK)
-- ============================================================

-- Bảng 1: Danh mục loại hồ sơ theo giai đoạn + bộ môn + hạng mục
-- Đây là template chuẩn (TKCS / BVTC / ...)
CREATE TABLE IF NOT EXISTS checklist_doc_types (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  stage       TEXT    NOT NULL,           -- 'TKCS' | 'BVTC' | ...
  discipline  TEXT    NOT NULL,           -- Bộ môn: 'KIẾN TRÚC', 'KẾT CẤU', 'HTKT', ...
  item_code   TEXT,                       -- Mã hạng mục: 'A1', 'A2', 'CL', ...  (null = thuyết minh chung)
  item_name   TEXT,                       -- Tên hạng mục: 'Nhà A', 'San nền', ...
  doc_name    TEXT    NOT NULL,           -- Tên loại hồ sơ: 'Mặt Bằng Định Vị', ...
  sort_order  INTEGER DEFAULT 0,
  is_active   INTEGER DEFAULT 1,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cdt_stage_discipline ON checklist_doc_types(stage, discipline);

-- Bảng 2: Hồ sơ nhận được (lần nộp - mỗi lần TVTK gửi HS)
CREATE TABLE IF NOT EXISTS checklist_submissions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage        TEXT    NOT NULL,           -- 'TKCS' | 'BVTC'
  version      TEXT    DEFAULT 'V1',       -- Phiên bản: V1, V2, ...
  sender       TEXT,                       -- Người gửi (TVTK)
  receiver     TEXT,                       -- Người nhận (CĐT)
  received_date DATE,                      -- Ngày nhận HS
  feedback_date DATE,                      -- Ngày phản hồi
  status       TEXT    DEFAULT 'pending',  -- 'pending'|'reviewing'|'completed'
  notes        TEXT,
  created_by   INTEGER REFERENCES users(id),
  created_at   DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_cs_project ON checklist_submissions(project_id);

-- Bảng 3: Chi tiết từng loại HS trong mỗi lần nộp
CREATE TABLE IF NOT EXISTS checklist_submission_items (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id  INTEGER NOT NULL REFERENCES checklist_submissions(id) ON DELETE CASCADE,
  doc_type_id    INTEGER REFERENCES checklist_doc_types(id),
  discipline     TEXT    NOT NULL,   -- copy từ doc_type để tránh orphan
  item_code      TEXT,
  item_name      TEXT,
  doc_name       TEXT    NOT NULL,
  has_doc        INTEGER DEFAULT 0,  -- 0=Chưa có | 1=Đã có | 2=Không áp dụng
  file_ref       TEXT,               -- Số bản vẽ / tên file tham chiếu
  notes          TEXT,
  updated_by     INTEGER REFERENCES users(id),
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_csi_submission ON checklist_submission_items(submission_id);
CREATE INDEX IF NOT EXISTS idx_csi_discipline  ON checklist_submission_items(discipline);

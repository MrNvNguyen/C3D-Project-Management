-- ===================================================
-- Migration 0006: Module Hồ Sơ Pháp Lý Dự Án
-- Legal Documents & Outgoing Letters Tracking
-- ===================================================

-- ── 1. Giai đoạn pháp lý (A, B, C, D) mặc định cho từng dự án ──────────────
CREATE TABLE IF NOT EXISTS legal_stages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  code        TEXT NOT NULL,        -- 'A' | 'B' | 'C' | 'D'
  name        TEXT NOT NULL,        -- VD: "Giai đoạn chuẩn bị gói thầu"
  sort_order  INTEGER DEFAULT 0,
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, code)
);

-- ── 2. Hạng mục pháp lý (item + sub-item, tree 2 cấp) ─────────────────────
CREATE TABLE IF NOT EXISTS legal_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id        INTEGER NOT NULL REFERENCES legal_stages(id) ON DELETE CASCADE,
  parent_id       INTEGER REFERENCES legal_items(id) ON DELETE CASCADE,  -- NULL = item cha
  stt             TEXT NOT NULL,       -- VD: "1", "1.1", "1.2", "3.1"
  title           TEXT NOT NULL,       -- Tên hạng mục
  item_type       TEXT DEFAULT 'task', -- 'group' | 'task' | 'document'
  due_date        DATE,
  status          TEXT DEFAULT 'pending',  -- pending | in_progress | completed | na
  notes           TEXT,
  sort_order      INTEGER DEFAULT 0,
  created_by      INTEGER REFERENCES users(id),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 3. Văn bản / Tài liệu đính kèm cho từng hạng mục ─────────────────────
CREATE TABLE IF NOT EXISTS legal_documents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  legal_item_id   INTEGER REFERENCES legal_items(id) ON DELETE SET NULL,
  doc_type        TEXT NOT NULL DEFAULT 'attachment',
  -- 'contract' | 'appendix' | 'acceptance' | 'payment' | 'letter' | 'other'
  title           TEXT NOT NULL,
  file_name       TEXT,
  file_url        TEXT,               -- link hoặc base64 nhỏ
  signed_date     DATE,
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 4. Văn bản gửi đi – tự động đánh số theo quy định dự án ──────────────
-- Định dạng số: {PREFIX}/{SEQ:03d}/{YEAR}  VD: "OC-V06TV08/001/2025"
CREATE TABLE IF NOT EXISTS outgoing_letters (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  legal_item_id   INTEGER REFERENCES legal_items(id) ON DELETE SET NULL,
  letter_number   TEXT NOT NULL,      -- Số văn bản (tự động)
  letter_seq      INTEGER NOT NULL,   -- Số thứ tự trong năm (1, 2, 3 ...)
  letter_year     INTEGER NOT NULL,   -- Năm ban hành
  subject         TEXT NOT NULL,      -- Trích yếu
  recipient       TEXT,               -- Người/cơ quan nhận (CĐT, TVGS…)
  sent_date       DATE,
  status          TEXT DEFAULT 'draft',  -- draft | sent | acknowledged
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── 5. Cấu hình prefix văn bản cho từng dự án ──────────────────────────────
-- VD: prefix = "OC" → số sẽ là OC/{project_code}/{seq:03d}/{year}
CREATE TABLE IF NOT EXISTS legal_letter_config (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  prefix          TEXT NOT NULL DEFAULT 'OC',  -- ký hiệu đơn vị
  include_project_code INTEGER DEFAULT 1,       -- 1 = thêm mã dự án vào số
  seq_reset_yearly INTEGER DEFAULT 1,           -- 1 = reset về 1 mỗi năm
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_legal_stages_project   ON legal_stages(project_id);
CREATE INDEX IF NOT EXISTS idx_legal_items_project    ON legal_items(project_id);
CREATE INDEX IF NOT EXISTS idx_legal_items_stage      ON legal_items(stage_id);
CREATE INDEX IF NOT EXISTS idx_legal_items_parent     ON legal_items(parent_id);
CREATE INDEX IF NOT EXISTS idx_legal_docs_project     ON legal_documents(project_id);
CREATE INDEX IF NOT EXISTS idx_legal_docs_item        ON legal_documents(legal_item_id);
CREATE INDEX IF NOT EXISTS idx_outgoing_project       ON outgoing_letters(project_id);
CREATE INDEX IF NOT EXISTS idx_outgoing_item          ON outgoing_letters(legal_item_id);
CREATE INDEX IF NOT EXISTS idx_outgoing_year          ON outgoing_letters(project_id, letter_year);

-- ── Seed: 4 giai đoạn mặc định sẽ được tạo tự động qua API khi tạo dự án ──
-- (Không seed cứng ở đây vì cần project_id động)
-- API POST /api/legal/init-project/:projectId sẽ tạo 4 giai đoạn + item mặc định

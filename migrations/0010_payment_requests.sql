-- ===================================================
-- Migration 0010: E. Tình trạng thanh toán
-- Payment Requests tracking for Legal module
-- ===================================================

CREATE TABLE IF NOT EXISTS payment_requests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  legal_item_id   INTEGER REFERENCES legal_items(id) ON DELETE SET NULL,
  -- Thông tin đề nghị thanh toán
  request_number  TEXT,                -- Số đề nghị thanh toán (VD: ĐN-01/2025)
  description     TEXT NOT NULL,       -- Nội dung thanh toán
  request_date    DATE,                -- Ngày đề nghị
  amount          REAL DEFAULT 0,      -- Số tiền đề nghị
  currency        TEXT DEFAULT 'VND',  -- Đơn vị tiền tệ
  -- Trạng thái thanh toán
  status          TEXT DEFAULT 'pending', -- pending | processing | partial | paid | rejected
  paid_amount     REAL DEFAULT 0,      -- Số tiền đã thanh toán (có thể TT một phần)
  paid_date       DATE,                -- Ngày thanh toán thực tế
  -- Thông tin hóa đơn
  invoice_number  TEXT,                -- Số hóa đơn
  invoice_date    DATE,                -- Ngày hóa đơn
  -- Đợt thanh toán
  payment_phase   TEXT,                -- VD: "Đợt 1", "Đợt 2", "Quyết toán"
  notes           TEXT,
  created_by      INTEGER REFERENCES users(id),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_payment_requests_project ON payment_requests(project_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_item    ON payment_requests(legal_item_id);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status  ON payment_requests(project_id, status);

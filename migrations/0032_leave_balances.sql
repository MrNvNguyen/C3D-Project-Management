-- =====================================================
-- Migration 0032: Leave Balances (Quota ngày phép)
-- =====================================================
-- Mỗi nhân viên có quota ngày phép năm (annual_leave).
-- Admin có thể đặt quota riêng cho từng người.
-- Mặc định = 12 ngày/năm (theo system_config hoặc hardcode).

CREATE TABLE IF NOT EXISTS leave_balances (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  year            INTEGER NOT NULL DEFAULT (strftime('%Y', 'now')),
  total_days      REAL    NOT NULL DEFAULT 12,   -- Tổng quota được cấp
  used_days       REAL    NOT NULL DEFAULT 0,    -- Đã dùng (tính từ approved leaves)
  note            TEXT,                          -- Ghi chú của admin
  updated_by      INTEGER,                       -- admin đã chỉnh
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (user_id, year),
  FOREIGN KEY (user_id)    REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_leave_balances_user_year ON leave_balances(user_id, year);

-- ── Trigger: tự động cập nhật updated_at ──────────────────────────────
CREATE TRIGGER IF NOT EXISTS trg_leave_balances_updated_at
  AFTER UPDATE ON leave_balances
BEGIN
  UPDATE leave_balances SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
END;

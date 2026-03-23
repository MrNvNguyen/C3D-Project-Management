-- ===================================================
-- Migration 0013: Asset Depreciation (Khấu hao tài sản)
-- ===================================================

-- Thêm các cột khấu hao vào bảng assets
ALTER TABLE assets ADD COLUMN depreciation_years INTEGER DEFAULT 0;
  -- 0 = không khấu hao, 3 = 3 năm, 5 = 5 năm

ALTER TABLE assets ADD COLUMN depreciation_start_date DATE;
  -- Ngày bắt đầu tính khấu hao (mặc định = purchase_date)

ALTER TABLE assets ADD COLUMN monthly_depreciation REAL DEFAULT 0;
  -- = purchase_price / (depreciation_years * 12), tính tự động

ALTER TABLE assets ADD COLUMN accumulated_depreciation REAL DEFAULT 0;
  -- Tổng khấu hao đã tích lũy (cập nhật theo tháng)

ALTER TABLE assets ADD COLUMN net_book_value REAL DEFAULT 0;
  -- Giá trị còn lại = purchase_price - accumulated_depreciation

ALTER TABLE assets ADD COLUMN depreciation_status TEXT DEFAULT 'none';
  -- none | active | completed | paused

-- Bảng lịch khấu hao từng tháng
CREATE TABLE IF NOT EXISTS asset_depreciation_schedule (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id              INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  year                  INTEGER NOT NULL,
  month                 INTEGER NOT NULL,           -- 1-12
  depreciation_amount   REAL NOT NULL DEFAULT 0,   -- Số tiền khấu hao tháng này
  accumulated_amount    REAL NOT NULL DEFAULT 0,   -- Lũy kế đến cuối tháng này
  net_book_value        REAL NOT NULL DEFAULT 0,   -- Giá trị còn lại cuối tháng
  is_allocated          INTEGER DEFAULT 0,          -- 1 = đã phân bổ vào shared costs
  shared_cost_id        INTEGER REFERENCES shared_costs(id) ON DELETE SET NULL,
  allocated_at          DATETIME,
  notes                 TEXT,
  created_at            DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(asset_id, year, month)
);

CREATE INDEX IF NOT EXISTS idx_depr_schedule_asset   ON asset_depreciation_schedule(asset_id);
CREATE INDEX IF NOT EXISTS idx_depr_schedule_year_month ON asset_depreciation_schedule(year, month);
CREATE INDEX IF NOT EXISTS idx_depr_schedule_allocated  ON asset_depreciation_schedule(is_allocated);

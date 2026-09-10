-- ===================================================
-- Migration 0037: Thêm trường VAT vào payment_requests
-- VAT (%) để tính doanh thu trước thuế
-- ===================================================

-- Thêm cột vat_pct vào payment_requests
ALTER TABLE payment_requests ADD COLUMN vat_pct REAL DEFAULT 0;

-- Comment giải thích logic tính doanh thu (SSOT docs/TU-DIEN-SO-LIEU.md + src/finance.ts):
-- Nghiệm thu trước VAT = amount (giá trị nghiệm thu) / (1 + vat_pct / 100)
-- Doanh thu vào sổ     = NT trước VAT × (1 - management_fee_pct / 100)
-- Dòng tiền trước VAT  = paid_amount / (1 + vat_pct / 100) — chỉ báo cáo GTTT, không làm booked
-- Ví dụ: NT amount=1,100,000, VAT=10%, fee_ql=30%
--   → NT trước VAT = 1,100,000 / 1.10 = 1,000,000
--   → DT vào sổ   = 1,000,000 × 70% = 700,000
-- (Comment cũ nhầm dùng paid_amount làm căn NT — đã sửa.)

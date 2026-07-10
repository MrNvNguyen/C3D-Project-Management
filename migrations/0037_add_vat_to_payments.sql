-- ===================================================
-- Migration 0037: Thêm trường VAT vào payment_requests
-- VAT (%) để tính doanh thu trước thuế
-- ===================================================

-- Thêm cột vat_pct vào payment_requests
ALTER TABLE payment_requests ADD COLUMN vat_pct REAL DEFAULT 0;

-- Comment giải thích logic tính doanh thu:
-- Doanh thu trước VAT = paid_amount / (1 + vat_pct / 100)
-- Doanh thu sau phí QL = doanh_thu_trước_vat × (1 - management_fee_pct / 100)
-- Ví dụ: paid=1,100,000, VAT=10%, fee_ql=30%
--   → DT trước VAT = 1,100,000 / 1.10 = 1,000,000
--   → DT vào sổ   = 1,000,000 × 70% = 700,000

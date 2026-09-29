-- Gói thầu của phiếu thanh toán khi không gắn hạng mục pháp lý.
-- Không đổi công thức tiền: amount / paid_amount / vat_pct vẫn đi qua syncPaymentToRevenue.
ALTER TABLE payment_requests ADD COLUMN package_id INTEGER REFERENCES legal_packages(id) ON DELETE SET NULL;

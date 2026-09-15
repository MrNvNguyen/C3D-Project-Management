-- Migration 0052: email provider column + Cloudflare fallback config seeds
-- provider NULL = legacy Resend sends

ALTER TABLE email_logs ADD COLUMN provider TEXT;

INSERT OR IGNORE INTO system_config (key, value, description) VALUES
  ('resend_daily_limit', '100', 'Số email Resend tối đa mỗi ngày (VN) trước khi fallback Cloudflare'),
  ('cloudflare_email_enabled', '1', 'Bật fallback gửi email qua Cloudflare Email Sending'),
  ('email_from_address', 'no-reply@bimonecadvn.com', 'Địa chỉ email gửi đi (Resend + Cloudflare)');

-- Cập nhật from address mặc định nếu còn giá trị seed cũ Resend onboarding
UPDATE system_config
SET value = 'no-reply@bimonecadvn.com',
    description = 'Địa chỉ email gửi đi (Resend + Cloudflare)'
WHERE key = 'email_from_address'
  AND (value IS NULL OR value = '' OR value = 'onboarding@resend.dev');

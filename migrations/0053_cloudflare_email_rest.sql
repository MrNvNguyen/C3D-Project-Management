-- Migration 0053: Cloudflare Email Sending REST credentials (Pages không hỗ trợ send_email binding)
INSERT OR IGNORE INTO system_config (key, value, description) VALUES
  ('cloudflare_account_id', '', 'Cloudflare Account ID dùng Email Sending REST API'),
  ('cloudflare_email_api_token', '', 'API Token quyền Email Sending:Edit');

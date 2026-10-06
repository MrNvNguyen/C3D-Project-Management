-- Mail nhắc quá hạn và báo cáo tuần: mặc định Thứ 6 lúc 09:00 (giờ VN).
-- Chỉ đổi giờ 8 (mặc định cũ). Giờ đã chọn khác 8 được giữ nguyên.
UPDATE system_config
SET value = '9',
    description = 'Giờ gửi mail nhắc quá hạn và báo cáo tuần (0-23, giờ VN)'
WHERE key = 'weekly_report_hour' AND value = '8';

INSERT OR IGNORE INTO system_config (key, value, description) VALUES
  ('weekly_report_hour', '9', 'Giờ gửi mail nhắc quá hạn và báo cáo tuần (0-23, giờ VN)');

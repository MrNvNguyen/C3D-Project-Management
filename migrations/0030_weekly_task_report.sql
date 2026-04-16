-- Weekly task report configuration
INSERT OR IGNORE INTO system_config (key, value, description) VALUES
  ('weekly_report_enabled', '1',   'Bật/tắt báo cáo task hàng tuần gửi cho System Admin'),
  ('weekly_report_day',     '5',   'Ngày gửi báo cáo tuần: 1=Thứ 2, 2=Thứ 3, 3=Thứ 4, 4=Thứ 5, 5=Thứ 6, 6=Thứ 7, 0=Chủ nhật'),
  ('weekly_report_hour',    '8',   'Giờ gửi báo cáo tuần (0-23, giờ VN)');

-- Add transport/road engineering disciplines (7 codes)
-- Rename existing EM 'Điều hòa thông gió' -> code 'HVAC' to free up 'EM' for transport usage
UPDATE disciplines SET code = 'HVAC' WHERE code = 'EM' AND name = 'Điều hòa thông gió';

INSERT OR IGNORE INTO disciplines (code, name, category) VALUES
  ('RS',  'Tuyến',                'transport'),
  ('TS',  'An toàn giao thông',   'transport'),
  ('BR',  'Cầu',                  'transport'),
  ('SD',  'Thoát nước',           'transport'),
  ('EM',  'Tường Chắn',           'transport'),
  ('LS',  'Chiếu sáng',           'transport'),
  ('SL',  'Gia cố mái',           'transport');

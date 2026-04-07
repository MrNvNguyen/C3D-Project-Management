-- Add MEP (Cơ điện tổng hợp) discipline if not exists
INSERT OR IGNORE INTO disciplines (code, name, category, is_active)
VALUES ('MEP', 'Cơ điện tổng hợp', 'mep', 1);

-- Migration 0025: Đổi tên 4 giai đoạn pháp lý từ tên cũ (chuẩn bị/tham gia/ký hợp đồng/nghiệm thu)
-- sang tên mới phù hợp thực tế dự án BIM (BCNCKT/GĐTK/Thi công/Hoàn công)
-- Chỉ cập nhật những stage vẫn còn tên cũ mặc định, không đụng tới tên đã được user tùy chỉnh.

UPDATE legal_stages
SET name = 'Hồ sơ BCNCKT (Báo cáo nghiên cứu khả thi)'
WHERE code = 'A'
  AND name IN (
    'Giai đoạn chuẩn bị gói thầu',
    'Giai đoạn A'
  );

UPDATE legal_stages
SET name = 'Hồ sơ GĐTK (Thiết kế kỹ thuật)'
WHERE code = 'B'
  AND name IN (
    'Giai đoạn tham gia gói thầu',
    'Giai đoạn B'
  );

UPDATE legal_stages
SET name = 'Hồ sơ Thi công'
WHERE code = 'C'
  AND name IN (
    'Giai đoạn ký hợp đồng và thực hiện gói thầu',
    'Giai đoạn C'
  );

UPDATE legal_stages
SET name = 'Hồ sơ Hoàn công'
WHERE code = 'D'
  AND name IN (
    'Giai đoạn nghiệm thu',
    'Giai đoạn D'
  );

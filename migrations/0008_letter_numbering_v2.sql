-- ===================================================
-- Migration 0008: Cập nhật quy định đánh số văn bản gửi đi
-- Format mới: {STT:02d}-{MÃ LOẠI}/OneCAD-BIM({SỐ HIỆU DỰ ÁN})
-- Ví dụ: 01-CV/OneCAD-BIM(TS.C08)
-- STT đánh theo loại văn bản, không reset hàng năm
-- ===================================================

-- Thêm cột letter_type (loại văn bản: cv, bc, bb, tb, qd, tt, kh, yc, pl, other...)
ALTER TABLE outgoing_letters ADD COLUMN letter_type TEXT NOT NULL DEFAULT 'cv';

-- Thêm cột letter_type_seq: số thứ tự theo loại văn bản trong project (không reset theo năm)
ALTER TABLE outgoing_letters ADD COLUMN letter_type_seq INTEGER NOT NULL DEFAULT 1;

-- Index hỗ trợ query seq theo project + type
CREATE INDEX IF NOT EXISTS idx_outgoing_type_seq ON outgoing_letters(project_id, letter_type, letter_type_seq);

-- Cập nhật bản ghi cũ: recalculate letter_type_seq dựa theo letter_seq cũ
-- (gán tạm = letter_seq cũ vì trước đây không có loại)
UPDATE outgoing_letters SET letter_type_seq = letter_seq WHERE letter_type_seq = 1 AND letter_seq > 1;

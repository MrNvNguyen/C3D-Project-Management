-- Migration 0009: Gắn tasks với legal_items trong module Hồ Sơ Pháp Lý
-- Cho phép tạo task trực tiếp trong sub-hạng mục của bảng theo dõi hồ sơ

ALTER TABLE tasks ADD COLUMN legal_item_id INTEGER REFERENCES legal_items(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_legal_item ON tasks(legal_item_id);

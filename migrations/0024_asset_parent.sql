-- Thêm cột parent_asset_id để hỗ trợ tài sản con (sub-asset / component)
ALTER TABLE assets ADD COLUMN parent_asset_id INTEGER REFERENCES assets(id);

-- Index để truy vấn tài sản con nhanh
CREATE INDEX IF NOT EXISTS idx_assets_parent ON assets(parent_asset_id);

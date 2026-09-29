-- Tài liệu tra cứu cho bong bóng chat. Không ghi log từng câu hỏi.
CREATE TABLE IF NOT EXISTS knowledge_articles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'workflow', -- workflow | technical
  audience TEXT NOT NULL DEFAULT 'all',  -- all, hoặc danh sách vai trò cách nhau bởi dấu phẩy
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

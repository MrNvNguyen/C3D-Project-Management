-- Danh bạ và nhật ký trao đổi của dự án (cùng cách khai báo với work: JSON trên dự án).
CREATE TABLE IF NOT EXISTS project_contact_books (
  project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  contacts_json TEXT NOT NULL DEFAULT '[]',
  logs_json TEXT NOT NULL DEFAULT '[]',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

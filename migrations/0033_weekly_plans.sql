-- ============================================================
-- 0033_weekly_plans.sql
-- Lập kế hoạch tuần & Báo cáo tình hình theo tuần cho dự án
-- ============================================================

-- Bảng kế hoạch tuần (mỗi tuần 1 record per project)
CREATE TABLE IF NOT EXISTS weekly_plans (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  week_start    TEXT NOT NULL,   -- ISO date: Monday of that week, e.g. '2025-04-28'
  week_end      TEXT NOT NULL,   -- ISO date: Sunday of that week, e.g. '2025-05-04'
  week_number   INTEGER,         -- Tuần thứ mấy trong năm (ISO week)
  year          INTEGER,
  title         TEXT,            -- Tiêu đề kế hoạch (VD: "Tuần 18 - 28/4~4/5/2025")
  overall_goal  TEXT,            -- Mục tiêu tổng quan tuần
  status        TEXT DEFAULT 'draft' CHECK(status IN ('draft','published','closed')),
  created_by    INTEGER REFERENCES users(id),
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(project_id, week_start)
);

-- Bảng các hạng mục kế hoạch trong tuần (từng dòng công việc kế hoạch)
CREATE TABLE IF NOT EXISTS weekly_plan_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id         INTEGER NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  sort_order      INTEGER DEFAULT 0,
  category        TEXT,                    -- Nhóm/hạng mục (VD: "Kiến trúc", "Kết cấu")
  description     TEXT NOT NULL,           -- Nội dung công việc cần làm
  assignee_ids    TEXT DEFAULT '[]',       -- JSON array of user IDs
  assignee_names  TEXT,                    -- Tên hiển thị (cache)
  target_date     TEXT,                    -- Ngày dự kiến hoàn thành trong tuần
  linked_task_id  INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
  priority        TEXT DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
  notes           TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Bảng báo cáo tuần (1 báo cáo per plan, có thể bổ sung nội dung ngoài kế hoạch)
CREATE TABLE IF NOT EXISTS weekly_reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id         INTEGER NOT NULL REFERENCES weekly_plans(id) ON DELETE CASCADE,
  project_id      INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  report_date     TEXT,                    -- Ngày lập báo cáo
  overall_summary TEXT,                   -- Tóm tắt tổng quan tuần
  next_week_plan  TEXT,                   -- Dự kiến tuần tới
  issues          TEXT,                   -- Vướng mắc / rủi ro
  attendance_note TEXT,                   -- Ghi chú nhân sự
  submitted_by    INTEGER REFERENCES users(id),
  submitted_at    DATETIME,
  status          TEXT DEFAULT 'draft' CHECK(status IN ('draft','submitted')),
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(plan_id)
);

-- Bảng kết quả từng hạng mục kế hoạch (1-1 với weekly_plan_items)
CREATE TABLE IF NOT EXISTS weekly_report_items (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id       INTEGER NOT NULL REFERENCES weekly_reports(id) ON DELETE CASCADE,
  plan_item_id    INTEGER REFERENCES weekly_plan_items(id) ON DELETE SET NULL,  -- NULL nếu là nội dung bổ sung
  sort_order      INTEGER DEFAULT 0,
  category        TEXT,
  description     TEXT NOT NULL,           -- Nội dung (copy từ plan_item hoặc bổ sung mới)
  result          TEXT,                    -- Kết quả thực tế
  completion_pct  INTEGER DEFAULT 0 CHECK(completion_pct BETWEEN 0 AND 100),
  status          TEXT DEFAULT 'in_progress' CHECK(status IN ('not_started','in_progress','completed','blocked','postponed')),
  assignee_names  TEXT,
  is_extra        INTEGER DEFAULT 0,       -- 1 = nội dung bổ sung ngoài kế hoạch
  notes           TEXT,
  created_at      DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_weekly_plans_project    ON weekly_plans(project_id, week_start DESC);
CREATE INDEX IF NOT EXISTS idx_weekly_plan_items_plan  ON weekly_plan_items(plan_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_weekly_reports_plan     ON weekly_reports(plan_id);
CREATE INDEX IF NOT EXISTS idx_weekly_report_items_rpt ON weekly_report_items(report_id, sort_order);

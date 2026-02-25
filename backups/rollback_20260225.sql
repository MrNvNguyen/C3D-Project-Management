-- ============================================================
-- BIM Management System - ROLLBACK SCRIPT
-- File: rollback_20260225.sql
-- Date: 2026-02-25
-- Description: Restore test/demo data removed during production cleanup
-- ============================================================
-- WARNING: This script RE-INSERTS deleted test data.
-- Only use if you need to revert the production cleanup.
-- PREFERRED: Restore from binary backup file instead:
--   backups/bim_management_pre_cleanup_20260225_100651.sqlite
-- ============================================================

BEGIN TRANSACTION;

-- Restore test projects
INSERT OR IGNORE INTO projects (id, code, name, description, client, project_type, status, start_date, end_date, budget, contract_value, admin_id, leader_id, created_by, created_at, updated_at)
VALUES
  (91,  'C08', 'Trụ sở 123', 'Test project', NULL, 'building', 'planning', '2026-02-25', NULL, 0, 0, NULL, NULL, 1, datetime('now'), datetime('now')),
  (116, '111',  '111123',    'Test project', NULL, 'building', 'planning', '2026-02-25', NULL, 0, 0, NULL, NULL, 1, datetime('now'), datetime('now'));

-- Restore junk tasks
INSERT OR IGNORE INTO tasks (id, project_id, title, status, due_date, actual_end_date, created_at, updated_at)
VALUES
  (56,  2,   '123',  'completed', NULL,         '2026-02-24', datetime('now'), datetime('now')),
  (92,  3,   'qqqq', 'completed', '2026-02-28', '2026-02-25', datetime('now'), datetime('now')),
  (258, 116, 'Thiết kế mặt đứng công trình 123', 'completed', '2026-02-25', '2026-02-25', datetime('now'), datetime('now'));

-- Restore project revenue for project 91
INSERT OR IGNORE INTO project_revenues (project_id, description, amount, revenue_date, payment_status, created_by)
VALUES (91, 'Test revenue', 45000000, '2026-02-24', 'pending', 1);

-- Restore category for project 116
INSERT OR IGNORE INTO categories (project_id, name, code, discipline_code, phase, status, created_by, created_at, updated_at)
VALUES (116, 'Kiến trúc Nhà làm việc chính', 'NLV-AA', NULL, 'basic_design', 'pending', 1, datetime('now'), datetime('now'));

COMMIT;

-- ============================================================
-- NOTE: task_history entries are NOT restored (they were stale demo logs).
-- NOTE: notifications are NOT restored (stale system messages).
-- NOTE: For a complete rollback, restore the binary SQLite backup file.
-- ============================================================

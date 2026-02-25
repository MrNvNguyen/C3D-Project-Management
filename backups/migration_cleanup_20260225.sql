-- ============================================================
-- BIM Management System - Production Cleanup Migration
-- File: migration_cleanup_20260225.sql
-- Date: 2026-02-25
-- Author: System
-- Description: Remove all test/demo data for production deploy
-- ============================================================
-- IMPORTANT: Run AFTER creating a full database backup
-- ROLLBACK: Restore from backups/bim_management_pre_cleanup_*.sqlite
-- ============================================================

BEGIN TRANSACTION;

-- ============================================================
-- STEP 1: RECORD COUNTS BEFORE CLEANUP (comment-only reference)
-- ============================================================
-- USERS: 5  (admin + 4 demo members)
-- PROJECTS: 5  (3 real + 2 test: id=91 code=C08, id=116 code=111)
-- TASKS: 18  (including junk: id=56 '123', id=92 'qqqq', id=258 'Thiết kế...123')
-- TIMESHEETS: 97
-- ASSETS: 5
-- PROJECT_COSTS: 81
-- PROJECT_REVENUES: 11 (including project 91)
-- NOTIFICATIONS: 17
-- CATEGORIES: 6 (including project 116 category)
-- COST_TYPES: 5
-- DISCIPLINES: 24
-- PROJECT_MEMBERS: 12
-- TASK_HISTORY: 46

-- ============================================================
-- STEP 2: CLEAN TEST/JUNK TASKS
-- ============================================================

-- Delete task_history for junk tasks first (no FK cascade here)
DELETE FROM task_history WHERE task_id IN (
  SELECT id FROM tasks 
  WHERE title IN ('123', 'qqqq')
     OR (title LIKE '%123%' AND project_id IN (91, 116))
);

-- Delete notifications referencing junk tasks
DELETE FROM notifications 
WHERE message LIKE '%task: 123%'
   OR message LIKE '%task: qqqq%'
   OR message LIKE '%"123"%'
   OR message LIKE '%"qqqq"%';

-- Delete junk tasks
DELETE FROM tasks 
WHERE title IN ('123', 'qqqq')
   OR (title LIKE '%123%' AND project_id IN (91, 116));

-- ============================================================
-- STEP 3: CLEAN TEST PROJECTS (CASCADE)
-- ============================================================

-- Delete task_history for tasks in test projects (no cascade on task_history)
DELETE FROM task_history 
WHERE task_id IN (SELECT id FROM tasks WHERE project_id IN (91, 116));

-- Delete timesheets for test projects
DELETE FROM timesheets WHERE project_id IN (91, 116);

-- Delete tasks in test projects
DELETE FROM tasks WHERE project_id IN (91, 116);

-- Delete project costs for test projects
DELETE FROM project_costs WHERE project_id IN (91, 116);

-- Delete project revenues for test projects
DELETE FROM project_revenues WHERE project_id IN (91, 116);

-- Delete project members for test projects
DELETE FROM project_members WHERE project_id IN (91, 116);

-- Delete categories for test projects (CASCADE would handle this but explicit is safer)
DELETE FROM categories WHERE project_id IN (91, 116);

-- Delete project labor costs for test projects
DELETE FROM project_labor_costs WHERE project_id IN (91, 116);

-- Delete notifications about test projects
DELETE FROM notifications 
WHERE message LIKE '%Trụ sở 123%'
   OR message LIKE '%111123%'
   OR message LIKE '%C08%';

-- Finally delete the test projects themselves
DELETE FROM projects WHERE id IN (91, 116);

-- ============================================================
-- STEP 4: CLEAN ORPHAN RECORDS
-- ============================================================

-- Orphan task_history (tasks no longer exist)
DELETE FROM task_history 
WHERE task_id NOT IN (SELECT id FROM tasks);

-- Orphan timesheets (user or project deleted)
DELETE FROM timesheets 
WHERE user_id NOT IN (SELECT id FROM users)
   OR project_id NOT IN (SELECT id FROM projects);

-- Orphan project_costs (project deleted)
DELETE FROM project_costs 
WHERE project_id NOT IN (SELECT id FROM projects);

-- Orphan project_revenues (project deleted)
DELETE FROM project_revenues 
WHERE project_id NOT IN (SELECT id FROM projects);

-- Orphan project_members (project or user deleted)
DELETE FROM project_members 
WHERE project_id NOT IN (SELECT id FROM projects)
   OR user_id NOT IN (SELECT id FROM users);

-- Orphan categories (project deleted)
DELETE FROM categories 
WHERE project_id NOT IN (SELECT id FROM projects);

-- Orphan notifications (user deleted)
DELETE FROM notifications 
WHERE user_id NOT IN (SELECT id FROM users);

-- Orphan assets (assigned_to user no longer exists)
UPDATE assets SET assigned_to = NULL 
WHERE assigned_to NOT IN (SELECT id FROM users);

-- ============================================================
-- STEP 5: CLEAR ALL NOTIFICATIONS (stale demo notifications)
-- ============================================================
-- All existing notifications are demo data - clear for fresh start
DELETE FROM notifications;

-- ============================================================
-- STEP 6: CLEAN TEST/DUPLICATE COSTS ON PROJECT 1
-- (Keep only the latest record per project+month+year+cost_type grouping)
-- ============================================================
DELETE FROM project_costs
WHERE id NOT IN (
  SELECT MAX(id) 
  FROM project_costs 
  GROUP BY project_id, month, year, cost_type
);

-- ============================================================
-- STEP 7: ENSURE DEFAULT COST TYPES EXIST
-- ============================================================
INSERT OR IGNORE INTO cost_types (name, code) VALUES ('Lương nhân sự', 'salary');
INSERT OR IGNORE INTO cost_types (name, code) VALUES ('Chi phí vật liệu', 'material');
INSERT OR IGNORE INTO cost_types (name, code) VALUES ('Chi phí thiết bị', 'equipment');
INSERT OR IGNORE INTO cost_types (name, code) VALUES ('Chi phí vận chuyển', 'transport');
INSERT OR IGNORE INTO cost_types (name, code) VALUES ('Chi phí khác', 'other');

-- ============================================================
-- STEP 8: ENSURE DEFAULT DISCIPLINES EXIST
-- ============================================================
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('ZZ', 'Tổng hợp');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('AA', 'Kiến trúc');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('AD', 'Nội thất');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('AF', 'Mặt dựng');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('ES', 'Kết cấu');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('EM', 'Điều hòa thông gió');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('EE', 'Điện sinh hoạt');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('EP', 'Cấp thoát nước sinh hoạt');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('EF', 'Chữa cháy');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('EC', 'Thông tin liên lạc');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('CL', 'San nền');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('CT', 'Giao thông');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('CD', 'Thoát nước mưa');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('CS', 'Thoát nước thải');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('CW', 'Cấp nước');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('CF', 'Chữa cháy (hạ tầng)');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('CE', 'Điện (hạ tầng)');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('CC', 'Thông tin (hạ tầng)');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('LA', 'Cảnh quan');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('LW', 'Cấp nước cảnh quan');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('LD', 'Thoát nước cảnh quan');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('LR', 'Tường chắn');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('LE', 'Kè');
INSERT OR IGNORE INTO disciplines (code, name) VALUES ('LL', 'Chiếu sáng');

-- ============================================================
-- STEP 9: VERIFY SYSTEM ADMIN EXISTS
-- ============================================================
-- Safety check: admin must exist (will fail transaction if not)
SELECT CASE 
  WHEN (SELECT COUNT(*) FROM users WHERE username='admin' AND role='system_admin') = 1
  THEN 'OK: admin exists'
  ELSE (SELECT RAISE(ROLLBACK, 'CRITICAL: admin user missing - aborting cleanup'))
END as admin_check;

-- ============================================================
-- STEP 10: DATABASE OPTIMIZATION
-- ============================================================
-- Note: VACUUM must run outside transaction - see post-migration steps

COMMIT;

-- ============================================================
-- POST-COMMIT STEPS (run separately after COMMIT):
-- VACUUM;           -- Reclaim free space
-- ANALYZE;          -- Update query planner statistics
-- PRAGMA integrity_check;  -- Verify DB integrity
-- ============================================================

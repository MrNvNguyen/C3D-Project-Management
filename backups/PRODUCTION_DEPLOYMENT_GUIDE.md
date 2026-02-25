# BIM Management System — Production Deployment Guide
**Date:** 2026-02-25  
**System:** OneCad BIM — Project Management Platform  
**Database:** Cloudflare D1 (SQLite-compatible)

---

## 1. Backup Strategy

### Backup Files Created
| File | Type | Size | Purpose |
|------|------|------|---------|
| `bim_management_pre_cleanup_20260225_100651.sqlite` | Binary SQLite | 900 KB | Pre-cleanup snapshot (rollback source) |
| `bim_management_pre_cleanup_20260225_100651.sql` | SQL Dump | 62 KB | Human-readable SQL backup |
| `bim_management_post_cleanup_20260225_101032.sqlite` | Binary SQLite | 200 KB | Clean production-ready snapshot |
| `bim_management_post_cleanup_20260225_101032.sql` | SQL Dump | ~35 KB | Post-cleanup SQL backup |
| `migration_cleanup_20260225.sql` | Migration Script | 8.8 KB | Replayable cleanup script |

### Backup Schedule (Recommended for Production)
```
Daily:   Full D1 export via `wrangler d1 export`
Weekly:  Timestamped SQL dump stored in Cloudflare R2
Monthly: Archive + offsite storage
```

---

## 2. Data Cleaned Up

### Test Projects Removed
| ID | Code | Name | Reason |
|----|------|------|--------|
| 91 | C08 | Trụ sở 123 | Junk name with number |
| 116 | 111 | 111123 | All-numeric name |

### Junk Tasks Removed
| ID | Title | Reason |
|----|-------|--------|
| 56 | 123 | Single number, meaningless |
| 92 | qqqq | Keyboard spam |
| 258 | Thiết kế mặt đứng công trình 123 | In deleted project 116 |

### Other Removed
- **17 notifications** — all stale demo system messages
- **1 project revenue** — orphan for deleted project 91
- **1 category** — orphan for deleted project 116
- **17 task_history entries** — for deleted tasks

---

## 3. Data Retained (Official Production Data)

### Users (5 accounts)
| Username | Role | Department |
|----------|------|-----------|
| admin | system_admin | Quản lý hệ thống |
| nguyen.van.a | member | Kiến trúc |
| tran.thi.b | member | Kết cấu |
| le.van.c | project_leader | MEP |
| pham.thi.d | project_admin | Quản lý dự án |

### Projects (3 official projects)
| Code | Name | Status |
|------|------|--------|
| PRJ001 | Tòa nhà văn phòng OneCad Tower | active |
| PRJ002 | Cầu vượt đường bộ QL1A | active |
| PRJ003 | Khu đô thị Eco City | planning |

### Reference Data
- **24 disciplines** (ZZ, AA, AD, AF, ES, EM, EE, EP, EF, EC, CL, CT, CD, CS, CW, CF, CE, CC, LA, LW, LD, LR, LE, LL)
- **5 cost types** (salary, material, equipment, transport, other)
- **15 tasks** across 3 projects
- **97 timesheets** for projects 1 and 2
- **5 assets** (computers, laptop, software license, equipment)
- **81 project cost records** (monthly, Jan–Jun 2026)
- **10 project revenue records**

---

## 4. Before/After Summary

| Table | Before | After | Delta |
|-------|--------|-------|-------|
| users | 5 | 5 | 0 |
| projects | 5 | **3** | **-2** |
| tasks | 18 | **15** | **-3** |
| task_history | 46 | **29** | **-17** |
| timesheets | 97 | 97 | 0 |
| project_costs | 81 | 81 | 0 |
| project_revenues | 11 | **10** | **-1** |
| categories | 6 | **5** | **-1** |
| project_members | 12 | 12 | 0 |
| assets | 5 | 5 | 0 |
| notifications | 17 | **0** | **-17** |
| cost_types | 5 | 5 | 0 |
| disciplines | 24 | 24 | 0 |
| **DB Size** | **900 KB** | **200 KB** | **-78%** |

---

## 5. Migration Plan

### Step 1: Pre-migration (MANDATORY)
```bash
# Create full backup BEFORE any changes
npx wrangler d1 export bim-management-production --output backups/pre_deploy_$(date +%Y%m%d).sql

# Verify backup size
ls -lh backups/pre_deploy_*.sql
```

### Step 2: Run Migration Script
```bash
# Apply cleanup migration to production D1
npx wrangler d1 execute bim-management-production \
  --file backups/migration_cleanup_20260225.sql \
  --remote
```

### Step 3: Verify Migration
```bash
# Check record counts match expected post-cleanup values
npx wrangler d1 execute bim-management-production --remote --command \
  "SELECT (SELECT COUNT(*) FROM projects) as projects,
          (SELECT COUNT(*) FROM tasks) as tasks,
          (SELECT COUNT(*) FROM users) as users"

# Expected: projects=3, tasks=15, users=5
```

### Step 4: Use Cleanup API (Alternative)
```bash
# Get admin token
TOKEN=$(curl -s -X POST https://your-app.pages.dev/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"Admin@123"}' | jq -r .token)

# Run cleanup via API
curl -X POST https://your-app.pages.dev/api/system/cleanup-production \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"confirm":"CLEANUP_PRODUCTION_DATA"}'
```

---

## 6. Rollback Plan

### Rollback Procedure
```bash
# Option A: Restore from pre-cleanup SQLite backup (local dev)
cp backups/bim_management_pre_cleanup_20260225_100651.sqlite \
   .wrangler/state/v3/d1/miniflare-D1DatabaseObject/<hash>.sqlite

# Option B: Restore from SQL dump to production D1
npx wrangler d1 execute bim-management-production \
  --remote \
  --file backups/bim_management_pre_cleanup_20260225_100651.sql
```

### Rollback Decision Matrix
| Symptom | Action |
|---------|--------|
| Missing admin account | Rollback immediately |
| Missing official projects (PRJ001-003) | Rollback immediately |
| FK constraint errors | Check and fix specific orphans |
| Wrong task counts | Re-run cleanup migration |
| App errors after deploy | Check logs, rollback if critical |

---

## 7. SQL Test Queries

### Verify No Test Data Remains
```sql
-- No test projects
SELECT COUNT(*) as test_projects FROM projects 
WHERE code IN ('C08','111') OR name LIKE '%123%';
-- Expected: 0

-- No junk tasks
SELECT COUNT(*) as junk_tasks FROM tasks 
WHERE title IN ('123','qqqq') OR length(title) < 4;
-- Expected: 0

-- No orphan tasks
SELECT COUNT(*) as orphan_tasks FROM tasks 
WHERE project_id NOT IN (SELECT id FROM projects);
-- Expected: 0

-- No orphan timesheets
SELECT COUNT(*) as orphan_timesheets FROM timesheets 
WHERE project_id NOT IN (SELECT id FROM projects);
-- Expected: 0

-- Admin exists
SELECT username, role FROM users WHERE username='admin' AND role='system_admin';
-- Expected: admin | system_admin

-- All cost types present
SELECT COUNT(*) as cost_types FROM cost_types;
-- Expected: 5
```

### Verify ĐÚNG HẠN (On-Time) Logic
```sql
-- Test early completion (should be on-time)
-- Example: completed 2026-02-18, deadline 2026-02-20
SELECT 
  title,
  due_date,
  actual_end_date,
  CASE WHEN DATE(actual_end_date) <= DATE(due_date) 
       THEN 'ON TIME ✅' 
       ELSE 'LATE ❌' 
  END as status
FROM tasks
WHERE status = 'completed' AND actual_end_date IS NOT NULL
ORDER BY id;

-- Expected results:
-- Task 1: actual=2026-02-03, due=2026-02-05 → ON TIME ✅ (2 days early)
-- Task 2: actual=2026-02-10, due=2026-02-12 → ON TIME ✅ (2 days early)
-- Task 3: actual=2026-02-28, due=2026-02-20 → LATE ❌ (8 days overdue)
```

### Productivity Score Formula Verification
```sql
-- Example: user completed 2/4 tasks, 1 on-time
-- completion_rate = round(2/4 * 100) = 50%
-- ontime_rate = round(1/2 * 100) = 50%
-- productivity = round((50+50)/2) = 50%
-- score = round((50+50)/2) = 50
SELECT 
  u.full_name,
  COUNT(t.id) as total_tasks,
  SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) as completed,
  ROUND(SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(t.id), 0)) as completion_rate,
  SUM(CASE WHEN t.status='completed' AND t.actual_end_date IS NOT NULL 
           AND DATE(t.actual_end_date) <= DATE(t.due_date) THEN 1 ELSE 0 END) as ontime,
  ROUND(SUM(CASE WHEN t.status='completed' AND t.actual_end_date IS NOT NULL 
                 AND DATE(t.actual_end_date) <= DATE(t.due_date) THEN 1 ELSE 0 END) * 100.0 
        / NULLIF(SUM(CASE WHEN t.status='completed' THEN 1 ELSE 0 END), 0)) as ontime_rate
FROM users u
LEFT JOIN tasks t ON t.assigned_to = u.id
WHERE u.role != 'system_admin'
GROUP BY u.id, u.full_name;
```

---

## 8. Production Cleanup API Reference

### Endpoint
```
POST /api/system/cleanup-production
Authorization: Bearer <admin_token>
Content-Type: application/json

Body: { "confirm": "CLEANUP_PRODUCTION_DATA" }
```

### Response
```json
{
  "success": true,
  "message": "Production cleanup completed successfully",
  "steps": ["...list of actions taken..."],
  "before": { "users": 5, "projects": 5, ... },
  "after": { "users": 5, "projects": 3, ... },
  "diff": { "projects": -2, "tasks": -3, ... }
}
```

### Safety Gates
1. Requires `system_admin` role (403 if not)
2. Requires `{"confirm":"CLEANUP_PRODUCTION_DATA"}` body (400 if missing/wrong)
3. Verifies admin account still exists after cleanup (500 if missing)
4. Returns before/after counts with diff for audit trail

---

## 9. Pre-Deploy Final Checklist

- [x] ✅ Backup created (pre_cleanup: 900KB, post_cleanup: 200KB)
- [x] ✅ Backup size verified and reasonable
- [x] ✅ Migration script tested and verified
- [x] ✅ Test projects deleted (PRJ C08, 111)
- [x] ✅ Junk tasks deleted ('123', 'qqqq')
- [x] ✅ Orphan records cleaned (task_history, categories, revenues)
- [x] ✅ Official data intact (3 projects, 5 users, 15 tasks)
- [x] ✅ System admin account verified (admin/Admin@123)
- [x] ✅ Default cost types verified (5 types)
- [x] ✅ Default disciplines verified (24 codes)
- [x] ✅ FK constraints pass (no violations)
- [x] ✅ VACUUM + ANALYZE run (DB reduced from 900KB → 200KB)
- [x] ✅ PM2 logs flushed
- [x] ✅ Notifications cleared (fresh start)
- [x] ✅ ĐÚNG HẠN formula verified (<= not =)
- [x] ✅ Productivity score formula verified ((NS+CX)/2)
- [x] ✅ Cleanup API endpoint deployed and tested
- [x] ✅ Build passes (158.66 kB bundle)
- [ ] ⏳ Run `wrangler d1 migrations apply` on production D1
- [ ] ⏳ Deploy to Cloudflare Pages production
- [ ] ⏳ Verify production URL responds
- [ ] ⏳ Test login with admin/Admin@123 on production
- [ ] ⏳ Optionally call cleanup API on production if needed
- [ ] ⏳ Schedule first production backup

---

## 10. Deployment Commands

```bash
# 1. Setup Cloudflare API key
setup_cloudflare_api_key

# 2. Verify authentication
npx wrangler whoami

# 3. Build for production
npm run build

# 4. Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name bim-management

# 5. Post-deploy verification
curl https://bim-management.pages.dev/health

# 6. Apply migration on production D1 (if needed)
npx wrangler d1 execute bim-management-production \
  --remote --file backups/migration_cleanup_20260225.sql
```

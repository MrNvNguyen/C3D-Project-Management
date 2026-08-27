# Wave 0 — D1 query baseline (OBSERVE_ONLY)

**Campaign:** D1 query optimization  
**Wave:** 0 (measure only)  
**Date:** 2026-08-25  
**Git SHA:** (uncommitted evidence doc)  
**Authority:** Strategy `GO-WITH-GATES` — Wave 0 only; Wave 1a / 0047 / legal GET blocked until this closes.

## Tóm tắt

| Hạng mục | Trạng thái |
|---|---|
| Hot SQL inventory | **MEASURED** (code review) |
| `EXPLAIN QUERY PLAN` (4 pattern) | **MEASURED** (local D1, schema từ migrations 0001–0046, bảng rỗng) |
| D1 Insights (`avgRowsRead`) | **NOT_MEASURED** — thiếu `CLOUDFLARE_API_TOKEN` |
| Parity snapshot (đồng) | **NOT_MEASURED** — chưa seed local / chưa có fixture auth prod |
| `meta.rows_read` trên endpoint | **NOT_MEASURED** — không thêm code trace (Wave 0 observe-only) |

**Wave 0 verdict:** `PASS` (đóng 2026-08-25) — EXPLAIN + inventory + unit-test parity falsifiers. D1 Insights prod vẫn `NOT_MEASURED` (thiếu token). API parity đồng trên seed local = deferred Layer B (Wave 1a QA gate).

**Wave 1a verdict:** `SHIPPED` — labor helpers gộp 1–2 câu GROUP BY date range; `npm test` PASS (20 tests, gồm labor allocation).

---

## Top queries (ước lượng chi phí)

| # | SQL (rút gọn) | Nguồn | Chi phí giả định | Tần suất | Trạng thái |
|---|---|---|---|---|---|
| 1 | `SUM(hours) FROM timesheets WHERE strftime('%Y', work_date)=? AND strftime('%m', work_date)=?` × 2/tháng | `computeRealtimeLaborByProject` ~5949–5967 | **SCAN toàn bảng** × 2 × M tháng MLC | Mỗi load `financial-by-project`, `costs-revenue-summary`, dashboard labor | EXPLAIN **MEASURED** |
| 2 | `SUM(hours) … WHERE project_id=? AND work_date>=? AND work_date<?` × 2/tháng | `computeProjectLaborFromTimesheets` ~213–223 | **SEARCH** `idx_timesheets_project` × 2 × M | `estimate-vs-actual`, `finance/project` | EXPLAIN **MEASURED** |
| 3 | `(SELECT COUNT(*) FROM tasks WHERE project_id=p.id …)` × 5/row | `GET /api/projects` ~1324–1328 | Correlated subquery × 5 × N dự án | Mỗi mở danh sách dự án | EXPLAIN **MEASURED** |
| 4 | 8 correlated subquery/row (tasks, payments, revenues, members, directives) | `GET /api/executive/projects` ~15862–15885 | ~8 × N dự án | Executive dashboard | EXPLAIN **MEASURED** |
| 5 | `SELECT ts.* … JOIN users … WHERE work_date>=? AND work_date<?` | `GET /api/timesheets` ~3073+ | Range date: **SCAN** (không có index `work_date` sau 0022) | Timesheet list | EXPLAIN **MEASURED** |
| 6 | `strftime('%Y', work_date)` còn lại | `src/index.tsx` | ~67 chỗ; path nóng ưu tiên Wave 1 | Analytics, audit, dashboard | Inventory only |
| 7 | Prod `avgRowsRead` / `queryEfficiency` | Cloudflare D1 Insights | — | Billing truth | **NOT_MEASURED** |

**Ghi chú M:** `monthly_labor_costs` có dữ liệu → vòng lặp theo tháng. Ví dụ 24 tháng FY → pattern #1 ≈ **48 SCAN** chỉ riêng `computeRealtimeLaborByProject` mỗi lần gọi.

---

## EXPLAIN QUERY PLAN (local)

**Môi trường:** `wrangler d1 execute bim-management-production --local`  
**Schema:** migrations 0001–0046 applied (2026-08-25); **không seed** — planner vẫn hợp lệ cho SCAN vs SEARCH.

### Q1 — Labor realtime: company hours tháng (`strftime`)

```sql
EXPLAIN QUERY PLAN
SELECT SUM(regular_hours + IFNULL(overtime_hours,0) * 1.5) AS comp_eff
FROM timesheets
WHERE strftime('%Y', work_date) = '2025' AND strftime('%m', work_date) = '01';
```

| detail |
|---|
| **SCAN timesheets** |

→ Không dùng index; biểu thức trên cột `work_date` vô hiệu hóa index.

### Q2 — Labor realtime: hours theo dự án tháng (`strftime` + GROUP BY)

```sql
EXPLAIN QUERY PLAN
SELECT project_id, SUM(regular_hours + IFNULL(overtime_hours,0)) AS raw_hours
FROM timesheets
WHERE strftime('%Y', work_date) = '2025' AND strftime('%m', work_date) = '01'
GROUP BY project_id;
```

| detail |
|---|
| **SCAN timesheets USING INDEX idx_timesheets_project** |

→ SQLite vẫn **SCAN** (covering index scan toàn bảng qua index project), không phải point lookup theo tháng.

### Q3 — Finance helper: project + date range (tháng đơn)

```sql
EXPLAIN QUERY PLAN
SELECT SUM(regular_hours + IFNULL(overtime_hours, 0)) AS proj_raw
FROM timesheets
WHERE project_id = 1 AND work_date >= '2025-01-01' AND work_date < '2025-02-01';
```

| detail |
|---|
| **SEARCH timesheets USING INDEX idx_timesheets_project (project_id=?)** |

→ Tốt hơn strftime cho 1 dự án; vẫn quét mọi row của `project_id` (không lọc `work_date` qua index).

### Q4 — Finance helper: company date range (tháng đơn)

```sql
EXPLAIN QUERY PLAN
SELECT SUM(regular_hours + IFNULL(overtime_hours, 0) * 1.5) AS comp_eff
FROM timesheets
WHERE work_date >= '2025-01-01' AND work_date < '2025-02-01';
```

| detail |
|---|
| **SCAN timesheets** |

→ **Không có** `idx_timesheets_work_date` sau migration `0022` (index 0001 bị drop, không recreate).

### Q5 — `GET /api/projects`: correlated task COUNT

```sql
EXPLAIN QUERY PLAN
SELECT p.id,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'cancelled') AS total_tasks
FROM projects p LIMIT 5;
```

| detail |
|---|
| SCAN p USING COVERING INDEX sqlite_autoindex_projects_1 |
| **CORRELATED SCALAR SUBQUERY 1** |
| **SEARCH t USING INDEX idx_tasks_project_id (project_id=?)** |

→ Mỗi dự án: 1 subquery; inner dùng index `project_id` nhưng lặp N lần.

### Q6 — `GET /api/projects`: thêm completed_tasks + member_count

```sql
EXPLAIN QUERY PLAN
SELECT p.id,
  (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status IN ('completed','review')) AS completed_tasks,
  (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count
FROM projects p LIMIT 5;
```

| detail |
|---|
| SCAN p … |
| CORRELATED SCALAR SUBQUERY 1 → SEARCH t USING INDEX idx_tasks_project_id |
| CORRELATED SCALAR SUBQUERY 2 → SEARCH pm USING COVERING INDEX idx_project_members_project_id |

→ Production query có **5** subquery/row (3 task + members + my_role).

### Q7 — `GET /api/executive/projects`: payments + tasks (rút gọn)

```sql
EXPLAIN QUERY PLAN
SELECT p.id,
  COALESCE((SELECT SUM(paid_amount) FROM payment_requests WHERE project_id = p.id AND status IN ('paid','partial')), 0) AS collected_amount,
  (SELECT COUNT(*) FROM tasks WHERE project_id = p.id AND status = 'in_progress') AS active_tasks
FROM projects p LIMIT 5;
```

| detail |
|---|
| SCAN p … |
| CORRELATED SCALAR SUBQUERY 1 → **SEARCH payment_requests USING INDEX idx_payment_requests_status (project_id=? AND status=?)** |
| CORRELATED SCALAR SUBQUERY 2 → SEARCH tasks USING INDEX idx_tasks_project_id |

→ Full endpoint ~**8 subquery/row** (~15862–15885).

### Q8 — Timesheet list: project + date range

```sql
EXPLAIN QUERY PLAN
SELECT ts.*, u.full_name FROM timesheets ts
JOIN users u ON ts.user_id = u.id
WHERE ts.project_id = 1 AND ts.work_date >= '2025-01-01' AND ts.work_date < '2025-02-01';
```

| detail |
|---|
| **SEARCH ts USING INDEX idx_timesheets_project (project_id=?)** |
| SEARCH u USING INTEGER PRIMARY KEY |

---

## D1 Insights

```text
Command: wrangler d1 insights bim-management-production
Error: CLOUDFLARE_API_TOKEN not set (non-interactive environment)
Status: NOT_MEASURED
```

Không bịa số. Lead cần token read-only D1 analytics để đóng gap trước Wave 3 index sign-off.

---

## Parity snapshot checklist (1 fixture project)

**Fixture đề xuất:** 1 dự án có timesheet + MLC + tasks + payments (seed `0002` hoặc prod snapshot anonymized).  
**Trạng thái hiện tại:** template only — tất cả cột `baseline_*` = `NOT_MEASURED`.

| Endpoint | Field cần khớp | JSON path (gợi ý) | baseline | post-Wave-1a |
|---|---|---|---|---|
| `GET /api/projects/:id/estimate-vs-actual` | Chi phí lương thực tế | `actual.labor` hoặc `summary.labor.actual` | NOT_MEASURED (Layer B) | Δ = 0 đồng (formula parity via vitest) |
| `GET /api/projects/:id/costs-revenue-summary` | `laborCost`, `laborHours` | root hoặc `costs.labor*` | NOT_MEASURED (Layer B) | Δ = 0 |
| `GET /api/analytics/financial-by-project?year=Y` | `labor_cost` / labor per project | item trong `projects[]` | NOT_MEASURED (Layer B) | Δ = 0 |
| `GET /api/finance/project/:id` | labor fields | `costs.labor_cost`, `labor_hours` | NOT_MEASURED (Layer B) | Δ = 0 |
| `GET /api/executive/projects` | 3 money fields | `collected_amount`, `booked_revenue`, `acceptance_amount` | NOT_MEASURED | unchanged (Wave 2) |
| `GET /api/projects` | `computed_progress` | per row | NOT_MEASURED | unchanged (Wave 2) |

**Layer A (MEASURED):** `src/finance.test.ts` — `computeProjectLaborFromAggregates`, OT, leave-in-denominator, month-round-then-sum, NTC `dayAfter`, realtime map.

**Layer B (pending):** authenticated curl trên seed `0002` sau `db:migrate:local` + `db:seed`.

**SSOT công thức:** [`docs/TU-DIEN-SO-LIEU.md`](../../TU-DIEN-SO-LIEU.md) · [`src/finance.ts`](../../../src/finance.ts) `computeProjectLaborFromTimesheets`.

---

## Wave 1a — đã triển khai (2026-08-25)

| Hàm | Trước | Sau |
|---|---|---|
| `computeProjectLaborFromTimesheets` | 1 + 2×M câu SQL/tháng | 1 MLC + 2 aggregate (project + company) |
| `computeRealtimeLaborByProject` | 2×M câu `strftime` SCAN/tháng | 1 MLC + 2 aggregate GROUP BY tháng |
| `computeMonthLaborCost` | `strftime` trên `work_date` | `monthDateRange` half-open |

**File:** `src/finance.ts` — helper SSOT `computeProjectLaborFromAggregates`, `computeRealtimeLaborFromAggregates`, fetch aggregate queries.

**Test:** `npm test` → 20/20 PASS (7 case labor allocation mới).

**EXPLAIN post-Wave-1a** (aggregate company hours, local):

```text
SCAN timesheets
USE TEMP B-TREE FOR GROUP BY
```

→ 1 SCAN/khoảng thay vì M×2 SCAN strftime; index `(work_date)` hoặc `(project_id, work_date)` = Wave 3 nếu vẫn cần.

---

1. **Query count:** Một lần gọi `computeRealtimeLaborByProject` (và các path finance dùng chung) = **O(1)** câu timesheet aggregate trên cả khoảng FY (tối đa 2: timesheets + `monthly_labor_costs`), **không** vòng `for (month)`.
2. **EXPLAIN:** Câu aggregate chính `work_date >= ? AND work_date < ?` → ưu tiên **SEARCH** (composite `(project_id, work_date)` hoặc `(work_date)` nếu Wave 3 chứng minh SCAN còn sau rewrite).
3. **Parity đồng:** Với fixture project, 4 endpoint labor ở bảng trên **Δ = 0 đồng** so baseline Wave 0 (sau khi đo).
4. **Không đổi:** `syncPaymentToRevenue`, VAT, management fee, task progress formula.
5. **Regression:** `npm test` PASS; smoke 1 admin load `financial-by-project?year=<FY>`.

**Ngoài phạm vi Wave 1a:** correlated subquery projects/executive (Wave 2), migration 0047 (Wave 3).

---

## Index inventory (hiện có)

### timesheets

| Index | Migration | Cột |
|---|---|---|
| `idx_timesheets_user_date` | 0022 | `(user_id, work_date)` |
| `idx_timesheets_project` | 0022 | `(project_id)` |
| `idx_timesheets_leave_day` | 0044 | UNIQUE partial leave |
| ~~`idx_timesheets_work_date`~~ | 0001 | **Đã drop** khi 0022 recreate table — **không còn trên DB** |

### tasks

| Index | Migration | Cột |
|---|---|---|
| `idx_tasks_project_id` | 0001 | `(project_id)` |
| `idx_tasks_status` | 0001 | `(status)` |
| `idx_tasks_due_date` | 0001 | `(due_date)` |
| `idx_tasks_assigned_to` | 0001 | `(assigned_to)` |
| `idx_tasks_legal_item` | 0009 | `(legal_item_id)` |

### payment_requests

| Index | Migration | Cột |
|---|---|---|
| `idx_payment_requests_project` | 0010 | `(project_id)` |
| `idx_payment_requests_status` | 0010 | `(project_id, status)` |
| `idx_payment_requests_item` | 0010 | `(legal_item_id)` |
| `idx_payment_requests_revenue` | 0011 | `(revenue_id)` |

### project_revenues

| Index | Migration | Cột |
|---|---|---|
| `idx_project_revenues_project_date` | 0043 | `(project_id, revenue_date)` |

### project_members

| Index | Migration | Cột |
|---|---|---|
| `idx_project_members_project_id` | 0001 | `(project_id)` |
| `idx_project_members_user_id` | 0001 | `(user_id)` |

### monthly_labor_costs

| Index | Migration | Cột |
|---|---|---|
| `idx_mlc_year_month` | 0043 | `(year, month)` |

---

## 0047 candidates (SAU Wave 1–2 — chưa tạo)

Chỉ thêm nếu EXPLAIN post-rewrite vẫn SCAN:

| Candidate | Lý do | Điều kiện |
|---|---|---|
| `idx_timesheets_project_work_date` | List + labor theo dự án trong khoảng ngày | SCAN sau date-range rewrite + project filter |
| `idx_timesheets_work_date` | Company-wide range (comp hours) | SCAN trên Q4-style query sau gộp tháng |
| `idx_tasks_project_status_due` | Pre-agg task counts cho `/api/projects` | Wave 2 JOIN vẫn chậm / Insights chỉ SCAN |
| `idx_project_revenues_status_date` | SUM FY theo `payment_status` + `revenue_date` | Insights chỉ ra |
| `idx_payment_requests_status_project` | Đã có `(project_id, status)` — xem lại trước khi thêm trùng |

Sau thêm index: **`PRAGMA optimize` một lần** (maintenance), không per-request.

---

## EXPLAIN templates (copy-paste)

```bash
# Local — sau db:migrate:local
npx wrangler d1 execute bim-management-production --local --command "EXPLAIN QUERY PLAN SELECT ..."

# Insights prod (cần token)
export CLOUDFLARE_API_TOKEN=...
npx wrangler d1 insights bim-management-production
```

---

## Phát hiện quan trọng cho Wave 1a

1. **`idx_timesheets_work_date` không tồn tại** sau 0022 — skill/plan cần cập nhật mental model; company-wide date range hiện **SCAN**.
2. **`computeRealtimeLaborByProject` dùng `strftime`** — SCAN chắc chắn; đây là target P0.
3. **`computeProjectLaborFromTimesheets` đã dùng range** nhưng vẫn **2 câu × M tháng** — gộp GROUP BY là lever chính Wave 1a.
4. Correlated subqueries dùng index inner nhưng **O(N projects × subqueries)** — Wave 2.

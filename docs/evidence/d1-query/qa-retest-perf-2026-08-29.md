# QA retest — performance / D1 tối ưu (2026-08-29)

**verify_sha (HEAD):** `0ebc921cdbd296652c2e997eafc05e858d879117` (+ working tree: `src/index.tsx`, `app.js`, preview tooling)  
**qa_tier:** Q2 PRODUCT_SPOT + engineering EXPLAIN  
**env:** D1 **local** only — không `--remote`

## Verdict

**PARTIAL — engineering tối ưu ổn (local); product Free-tier chưa chốt**

| Lớp | Kết quả |
|-----|---------|
| Layer A vitest | **PASS** — 23/23 (`finance` 20 + `authz-policy` 3) |
| EXPLAIN hot paths (local) | **PASS** — date-range / project+date / notif dùng INDEX SEARCH |
| Static inventory Tier 1–5 | **PASS** — boot không `/system/init`; tasks LIMIT; helpers labor; 0047+0048 indexes present |
| Layer B latency API (auth) | **NOT_MEASURED** — login local fail trong session (cần `JWT_SECRET` + user seed; đã thêm `.dev.vars` gitignored) |
| D1 Insights prod `avgRowsRead` | **NOT_MEASURED** — thiếu Cloudflare auth / ops gate |

## EXPLAIN (local D1) — đo lại

| Query | Kết quả planner |
|-------|-----------------|
| Timesheet `work_date >= ? AND < ?` | **SEARCH** `idx_timesheets_work_date` |
| Timesheet `project_id + work_date` range | **SEARCH** `idx_timesheets_project_work_date` |
| Projects JOIN pre-agg tasks | SCAN tasks covering `idx_tasks_project_id` + SEARCH join (không correlated COUNT/row) |
| Anti-pattern `strftime('%Y'/'%m')` | **SCAN timesheets** (sentinel — đúng là vẫn đắt) |
| Notifications unread COUNT | **SEARCH** `idx_notifications_user_read` |
| Notifications list by user | **SEARCH** `idx_notifications_user_id` |

Indexes confirmed local: `idx_timesheets_work_date`, `idx_timesheets_project_work_date`, `idx_notifications_user_id_id`, `idx_notifications_user_created`, `idx_notifications_read_created`.

## Code claims (static)

- Labor GET: `allocateProjectLaborForCalendarMonths` / `fetchProjectHoursByMonth` / half-open ranges.
- Boot FE: không gọi `/api/system/init`; dashboard dùng `overdue_tasks_list`; `fetchProjectsCached` + `fields=slim`.
- `GET /api/tasks`: không UPDATE `is_overdue` mỗi list; LIMIT; không trả `attachments`.
- Migration **0048** notifications indexes — applied local.

## Gaps / rủi ro còn mở

1. **Prod Insights** chưa đo → không kết luận Free (&lt;2M rows/ngày) vs Paid.
2. **Migration 0047/0048 remote** — theo `tier0-ops-gate-2026-08-29.md` vẫn NOT_MEASURED.
3. Một số path analytics vẫn `strftime` (không phải hot path Wave 1–2) — follow-up.
4. Pages `_routes.json` chỉ `include: ["/api/*"]` → `/health` **không** vào Worker (trả SPA HTML). Health check nên dùng `/api/...` hoặc mở rộng routes.
5. Local login Layer B: cần `.dev.vars` (`JWT_SECRET`) + `npm run db:seed:test` rồi mở `/preview` smoke thủ công.

## Kết luận cho PO/dev

- **Tối ưu D1 đã ship (code + index local): ổn** — planner chứng minh SEARCH thay SCAN trên path timesheet/labor/list projects/notifications.
- **Hệ thống “đã ổn trên Free prod?” → chưa đo được** — thiếu Insights 24–48h sau deploy + apply migration remote.
- Khuyến nghị: deploy working tree → apply `0047`/`0048` remote → đo Insights → mới CLOSE Free hoặc escalate Paid.

```yaml
run_class: PRODUCT_PASS_RUN | NOT_MEASURED (mixed)
attempt_outcome: PARTIAL
```

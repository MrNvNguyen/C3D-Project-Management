# D1 Free optimization — Tier 1–6 evidence (2026-08-29)

**Ràng buộc PO:** giữ Workers Free (< 5M rows read/ngày; mục tiêu vận hành < 2M).

**Phạm vi evidence:** Code + vitest. **Prod Insights / ALLOW_SYSTEM_INIT / remote migrations = NOT_MEASURED** (xem `tier0-ops-gate-2026-08-29.md`).

## Tier 0 — Ops

| Mục | Trạng thái |
|-----|------------|
| `ALLOW_SYSTEM_INIT` prod | NOT_MEASURED — PO tắt nếu `=1` |
| Migration 0047 remote | NOT_MEASURED |
| Migration 0048 local | ✅ applied |
| D1 Insights top queryDigest | NOT_MEASURED |

## Tier 1 — Boot / tasks / dashboard / notifications

| Thay đổi | File |
|----------|------|
| Bỏ `POST /system/init` khỏi boot | `app.js` `initApp` |
| Boot: `Promise.all` disciplines + config + `projects?fields=slim` | `app.js` |
| Cache projects TTL 5 phút | `fetchProjectsCached` |
| Dashboard overdue từ `overdue_tasks_list` — không gọi `/tasks?overdue=1` | `app.js` + `dashboard/stats` |
| `GET /api/tasks`: bỏ UPDATE `is_overdue`; tính trong SELECT; LIMIT; không trả `attachments` | `src/index.tsx` |
| `GET /api/projects?fields=slim` | `src/index.tsx` |
| Dashboard: CTE gộp status+discipline; bound member productivity 365d | `src/index.tsx` |
| Fiscal settings cache 60s | `getFiscalYearSettings` |
| Migration `0048_notifications_indexes.sql` | indexes user_id+id, user+created, is_read+created |
| Summary: COUNT unread + ORDER BY id DESC LIMIT 1 | notifications |
| `POST /api/notifications/purge-read` (admin, batch 90 ngày) | retention |
| Chat poll 30s → `pollNotificationBadge` | `app.js` |

## Tier 2 — Analytics / strftime

| Route | Trạng thái |
|-------|------------|
| `cost-summary` + `computeRealtimeLaborByProject` | ✅ (arc trước) |
| `analytics/timesheet`, `finance/labor-cost`, `monthly-labor-costs` | ✅ date range |
| `projects/:id/costs-summary` | ✅ `monthDateRange` (bỏ strftime) |
| `team-productivity`, leave summary, data-audit | ✅ (arc trước) |

## Tier 3 — Authz + SSOT

| Mục | Trạng thái |
|-----|------------|
| JWT_SECRET bắt buộc (fail closed) | ✅ |
| `canAccessProject` trên projects/:id, tasks/:id, messages, legal overview/payments GET, documents file | ✅ |
| `isProjectAdminOrAbove` trên payments POST/PUT, legal import | ✅ |
| Legal overview `project_budget` → `computeProjectBudget` | ✅ |
| Harness tối thiểu | `src/authz-policy.test.ts` |

## Tier 4 — Writes

| Mục | Trạng thái |
|-----|------------|
| timesheets bulk-import `db.batch` + ON CONFLICT | ✅ |
| shared-costs POST/PUT allocations `db.batch` | ✅ |
| legal import children `db.batch` chunks | ✅ |
| leave approve batch | ✅ (arc trước) |
| notifications retention route | ✅ |

## Tier 5 — Frontend

| Mục | Trạng thái |
|-----|------------|
| `public/_headers` cache static | ✅ |
| 1 XLSX stack lazy (`ensureXlsxLoaded`) | ✅ |
| `executive-dashboard.js` lazy | ✅ |
| Chart/axios/dayjs `defer` | ✅ |
| Tailwind CDN → CSS build | **deferred** (cần build pipeline; ghi nhận) |

## Tier 6 — Cổng Free vs Paid

| Đo | Kết quả |
|----|---------|
| Prod rows/ngày trước/sau | **NOT_MEASURED** |
| `npm test` | Chạy trong session triển khai |

**Quyết định (code-complete, chờ đo prod 3 ngày):**

- Nếu sau deploy Tier 1–2 mà rows **< 2M/ngày** → giữ Free, chốt arc.
- Nếu **2M–5M** → giữ Free + chạy `purge-read` ngoài giờ cao điểm; theo dõi tuần.
- Nếu vẫn **> 5M** → **Workers Paid ($5/tháng)** là fallback có điều kiện (không phải bước mặc định vì PO chọn Free).

## Ops checklist sau deploy

```bash
# 1. Tắt ALLOW_SYSTEM_INIT trên prod nếu đang =1
# 2. Apply migrations remote
npx wrangler d1 migrations apply bim-management-production --remote
# 3. Retention (ngoài giờ cao điểm)
curl -X POST .../api/notifications/purge-read -H "Authorization: Bearer <admin>"
# 4. Insights 24–48h sau deploy
npx wrangler d1 insights bim-management-production --sort-by reads
```

## Definition of Done (plan)

- [x] Boot không còn `/system/init` và `/tasks?overdue=1`
- [x] GET /api/tasks không ghi DB; có LIMIT; không attachments
- [x] Retention route 90 ngày (chạy lần đầu = ops)
- [x] dashboard/stats giảm full-scan tasks (CTE status+discipline)
- [x] notifications index + summary nhẹ + chat badge poll
- [x] cost-summary / analytics date-range
- [x] legal/payments authz + computeProjectBudget
- [x] Evidence + cổng Free/Paid ghi rõ (đo prod còn NOT_MEASURED)

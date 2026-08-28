# D1 Free — Wave triển khai code (2026-08-28)

**Mục tiêu:** Giảm rows read/write trên Workers Free (5M read/ngày) trước khi cân nhắc Paid.

**Phạm vi evidence:** Code + vitest. **Prod Insights = NOT_MEASURED** (cần PO/ops chạy trên Cloudflare dashboard).

## Ops (PO / admin Cloudflare — ngoài repo)

| Việc | Trạng thái |
|------|------------|
| Upgrade Workers Paid nếu đang bị chặn D1 | **Chưa xác minh** |
| `wrangler d1 migrations apply bim-management-production` (0047) trên **remote** | **Chưa xác minh** — local: `No migrations to apply` |
| D1 Insights snapshot trước/sau | **NOT_MEASURED** |

## Wave 1 — Poll thông báo (P0)

| Thay đổi | File |
|----------|------|
| Poll **5s → 60s**; pause khi tab hidden | `public/static/app.js` |
| Poll gọi `GET /api/notifications/summary` (COUNT + MAX id) | `src/index.tsx` |
| Full `GET /api/notifications` chỉ khi mở panel / có notif mới | `app.js` |
| List endpoint bỏ `SELECT *` | `src/index.tsx` |

**Ước lượng:** ~12× ít request notif/user/ngày; mỗi poll ~2 aggregate rows thay vì 50 row full scan + unread chat.

## Wave 2 — cost-summary labor (P0)

| Thay đổi | File |
|----------|------|
| Xóa vòng 12 tháng `strftime` trên timesheets | `GET /api/dashboard/cost-summary` |
| Dùng `computeRealtimeLaborByProject(db, ot, fyStart, fyEnd)` | `src/index.tsx` + `src/finance.ts` |

**Ước lượng:** 1 request cost-summary ≈ vài aggregate thay vì ~36 strftime/month queries.

## Wave 3 — strftime → date range (P0)

| Route | Thay đổi |
|-------|----------|
| `GET /api/analytics/timesheet` | `yearDateRange` + `work_date >= ? AND < ?` (7 query) |
| `GET /api/finance/labor-cost` | `monthDateRange` |
| `GET /api/monthly-labor-costs` | 1 GROUP BY thay N+1 strftime/row |

## Wave 4 — Index 0047

Migration: `migrations/0047_timesheets_work_date_indexes.sql`

- Local wrangler: đã apply (no pending).
- **Prod remote:** cần `wrangler d1 migrations list bim-management-production --remote`.

## Wave 5 — Write batch

| Thay đổi | File |
|----------|------|
| Leave approve: `db.batch` thay loop SELECT+INSERT/UPDATE từng ngày | `POST /api/leave-requests/:id/review` |

Labor sync `all_months`: **defer** — chưa đo Insights sau Wave 2–3.

## Wave 6 — P1 hot paths (2026-08-28 tiếp)

| Route / thay đổi | Chi tiết |
|-------------------|----------|
| `GET /api/dashboard/stats` | Gộp ~20 prepare tuần tự → `Promise.all` (1 batch song song) |
| `GET /api/dashboard/cost-summary` | `poolTotalLabor` từ `monthlyLaborSummary` (bỏ loop 12 tháng) |
| `POST /api/projects/:id/labor-costs/sync` `all_months` | `fetchProjectHoursByMonth` + `fetchCompanyEffHoursByMonth` + `db.batch` writes |
| `GET /api/analytics/team-productivity` | `yearDateRange` / `monthDateRange` |
| `GET /api/leave-requests/summary` | `yearDateRange` trên `start_date` |
| `GET /api/analytics/task-analytics` | `completionTrend` dùng `created_at` range |
| `GET /api/data-audit/consistency-check` | 5 aggregate GROUP BY thay N+1 strftime/project |
| `POST /api/data-audit/fix-inconsistency` `fix_labor` | 1 GROUP BY timesheets + `db.batch` upsert |

**Ước lượng:** dashboard/stats load ≈ wall-time 1 round-trip thay ~18 tuần tự; data-audit tháng ≈ 5 query + loop logic thay ~4×N project queries.

## Kiểm tra

```bash
npm test   # finance.test.ts 20/20 PASS
node scripts/copy-public.mjs
```

## Còn lại (P2 / theo Insights)

- Index notifications chỉ nếu EXPLAIN vẫn SCAN sau Wave 1
- Các `strftime` còn lại trên `birthday` (không hot path timesheet)
- `GET /api/financial-summary/*` — đã có hybrid; đo Insights nếu vẫn cao

## Free target

Sau deploy Wave 1–3 + 0047 prod: mục tiêu **< 2M rows read/ngày** với vài user (buffer dưới 5M). Nếu vẫn vượt với nhiều tab admin → Workers Paid là baseline vận hành ($5/tháng).

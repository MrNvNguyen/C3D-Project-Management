# D1 Free crisis — Wave 1 implementation (30/08 Insights)

**Phạm vi:** code + local migration; prod D1 Insights **NOT_MEASURED** until deploy + 24h heavy-use day.

**Baseline (2026-08-30 GMT+7):** 9M rows read/day; ~91% from `GET /api/tasks` + `GET /api/projects/:id/categories`.

## Shipped

| Wave | Change | File(s) |
|------|--------|---------|
| 1.1 | `idx_tasks_category` + pre-agg JOIN categories | `migrations/0051_tasks_category_index.sql`, `src/index.tsx` |
| 1.2 | Pre-agg `subtasks` + `task_history` JOIN on tasks list | `src/index.tsx` |
| 3 | Explicit `limit=500`, reuse project detail cache in Gantt | `public/static/app.js` |
| 4 | `read-all` only unread; `available-years` 5min cache; remove debug logs | `src/index.tsx`, `public/static/app.js` |
| 5 | Authz legal/payments/overview/tasks/messages — **already in tree** (Tier 3 prior) | `src/index.tsx`, `src/authz-policy.test.ts` |
| 6 | Guardrail in `bim-d1-query` skill | `.cursor/skills/bim-d1-query/SKILL.md` |

## Kỳ vọng sau deploy (ngày dùng Tasks + Project detail)

| Metric | Trước (30/08) | Mục tiêu |
|--------|---------------|----------|
| Rows read / ngày | 9M | **< 2M** |
| Tasks list ratio | ~344:1 | **< 100:1** |
| Categories ratio | ~1.21k:1 | **< 100:1** |
| Rows read / lần tasks | ~91k | hàng nghìn |
| Rows read / lần categories | ~21k | hàng trăm |

## Wave 2 — đo lại (PO/ops)

1. Deploy build + apply migrations `0048`–`0051` on prod (if not yet).
2. Set `JWT_SECRET` on Pages Production.
3. D1 Insights → Yesterday on a **heavy-use day** (open Tasks + Project detail).
4. Ghi digest + số lần gọi 2 endpoint vào file mới `wave2-remeasure-YYYY-MM-DD.md`.

## Product parity (manual)

- [ ] Project detail: `task_count` / `completed_tasks` per category unchanged.
- [ ] Tasks list: `subtask_count`, `subtask_done_count`, `first_review_date` unchanged.
- [ ] Gantt + project task tab same data as before (limit 500).

## Tests

```bash
npm run build
npm test
```

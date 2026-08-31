# Wave 0 — D1 baseline (local EXPLAIN + counts)

**Phạm vi:** local D1 (`wrangler d1 execute DB --local`). Prod remote **NOT_MEASURED** (no `CLOUDFLARE_API_TOKEN` / `wrangler login`).

**Ngày:** 2026-08-31

## Migrations

| Env | Trạng thái |
|-----|------------|
| Local | `0043`–`0050` applied; `0051` apply cùng deploy Wave 1 |
| Prod remote | **NOT_MEASURED** — PO/ops: `npx wrangler d1 migrations list bim-management-production --remote` |

## Row counts (local seed)

| Bảng | COUNT |
|------|------:|
| tasks | 5 |
| task_history | 0 |
| subtasks | 0 |
| categories | 4 |

## EXPLAIN QUERY PLAN — trước fix

### `GET /api/projects/:id/categories` (correlated)

```sql
SELECT c.*, (SELECT COUNT(*) FROM tasks t WHERE t.category_id = c.id) ...
WHERE c.project_id = 1
```

| detail |
|--------|
| SEARCH c USING INDEX idx_categories_project (project_id=?) |
| CORRELATED SCALAR SUBQUERY 1 |
| **SCAN t** |

### `GET /api/tasks` (correlated subtasks/history)

3 scalar subqueries per row → cost nhân theo số dòng khớp WHERE (ORDER BY trước LIMIT).

## Kỳ vọng sau Wave 1

- Categories: 1× GROUP BY `tasks` scoped `project_id`, JOIN `categories` — không SCAN tasks theo từng hàng category.
- Tasks: 1× GROUP BY `subtasks`, 1× GROUP BY `task_history` — không correlated theo từng task row.
- Index `idx_tasks_category` (0051) hỗ trợ pre-agg và delete guard.

## Regenerate

```bash
npx wrangler d1 execute DB --local --command "PRAGMA table_info(tasks);"
npx wrangler d1 execute DB --local --command "EXPLAIN QUERY PLAN SELECT ..."
```

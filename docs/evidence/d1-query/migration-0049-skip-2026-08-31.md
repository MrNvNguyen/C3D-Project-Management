# Migration 0049 — prod apply unblock (2026-08-31)

**Scope:** ops / schema only. Product list endpoints no longer SELECT these columns.

## Problem

`wrangler d1 migrations apply` / console run of `0049_tasks_extended_columns.sql` failed:

```text
Error: duplicate column name: hstk_date: SQLITE_ERROR
```

Columns `task_type`, `model_filename`, `cde_report`, `work_notes`, `hstk_date` already exist on production (legacy `POST /system/init` ALTER). SQLite has no `ADD COLUMN IF NOT EXISTS`.

## Fix

`0049` rewritten to **no-op** `SELECT … message` (same pattern as `0028` for `timesheets.category_id`). Marks migration applied without DDL.

## Apply order (prod)

```bash
npx wrangler d1 migrations apply bim-management-production --remote
```

Expect `0049` (no-op), then `0050` (may also fail if `timesheets.category_id` already exists — then convert/skip similarly), then `0051` (`CREATE INDEX IF NOT EXISTS` — safe).

## Verify columns present (prod console)

```sql
PRAGMA table_info(tasks);
-- expect: task_type, model_filename, cde_report, work_notes, hstk_date
```

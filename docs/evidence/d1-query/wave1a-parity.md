# Wave 1a parity Gate 0

**Date:** 2026-08-25  
**Authority:** Strategy Wave 1b — Gate 0 before 1b SQL edits  
**Git:** working tree has Wave 1a helpers; HEAD may still have pre-1a loops for helpers only

## Status: `NOT_MEASURED`

| Endpoint | Field | HEAD | Working tree | Δ |
|---|---|---|---|---|
| `GET /api/projects/:id/estimate-vs-actual` | labor actual | NOT_MEASURED | NOT_MEASURED | — |
| `GET /api/projects/:id/costs-revenue-summary` | laborCost / laborHours | NOT_MEASURED | NOT_MEASURED | — |
| `GET /api/analytics/financial-by-project` | labor_cost | NOT_MEASURED | NOT_MEASURED | — |
| `GET /api/finance/project/:id` | labor fields | NOT_MEASURED | NOT_MEASURED | — |

**Reason:** No authenticated seed fixture / admin token in agent environment (`npm` PATH / Cloudflare token unavailable for interactive login). Strategy allows Wave 1b to proceed with gap explicit; **blocks product PASS claim**.

## Layer A substitute (MEASURED)

`src/finance.test.ts` labor allocation cases (20/20):
- round per calendar month then sum
- OT on effective hours
- leave hours in company denominator
- skip empty month
- realtime map skips null project_id
- NTC `dayAfter` / `filterMlcMonths`

## How to close Gate 0 (manual)

```text
npm run db:migrate:local
npm run db:seed
npm run build && npm run dev:sandbox
# login as system_admin → Bearer token
# curl 4 endpoints for project_id=1, save JSON before/after Wave 1b
```

**Product PASS requires Δ = 0 đồng** on labor fields vs this table when filled.

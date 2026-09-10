# Evidence — finance_nt_dt_cash (Wave 0–3)

**Box:** `finance_nt_dt_cash`  
**Date:** 2026-09-10  
**Scope label:** Engineering + helper lock. Layer B product probe = **NOT_MEASURED** (no live auth session in this arc).

## Locked contract

```text
NT báo cáo     = amount / (1+vat%)     // pending+partial+paid
GTTT báo cáo   = paid_amount / (1+vat%) // partial+paid only
DT vào sổ      = project_revenues.amount // paid+partial+pending đã NT
Công nợ HĐ     = GTHĐ − GTTT (trước VAT)
```

Fixture: gross `1_100_000` / VAT 10% / fee 30% → NT `1_000_000`, DT_NS `700_000`, GTTT `0` nếu pending.

## Wave status

| Wave | Claim | Evidence |
|------|--------|----------|
| W0 | `aggregateThreeMoney` + `enrichRevenueRow` orphan-safe | `npm test -- --run src/finance.test.ts` → **27/27 PASS** |
| W1 | dashboard/executive/costs-summary NT/GTTT trước VAT; booked gồm pending | Code wired via `aggregateThreeMoney` / pending `request_date` join — **Q2 API NOT_MEASURED** |
| W2 | analytics NTC+lifetime DT gồm pending; % NT/GTHĐ; % DT/NS; resync `amount>0` incl. pending | Code in `index.tsx` — **Q2 NOT_MEASURED** |
| W3 | revenues `pq.amount` no COALESCE booked; PUT vat clamp; DELETE `isProjectAdminOrAbove` | Code — **Q2 NOT_MEASURED** |

## Layer B checklist (run after deploy + login)

1. Tạo / dùng phiếu **pending** NT `1.100.000` VAT 10% phí QL 30%.
2. Cùng số trên: HSPL Tình trạng TT · tab Doanh thu · analytics theo dự án · executive overview · costs-summary · dashboard YTD (cùng kỳ).
3. Expect: NT `1.000.000`, DT NS `700.000`, GTTT `0`.
4. Resync project → pending vẫn booked 700k.
5. Orphan revenue (không pq): NT không bị trừ VAT lần 2.

## Do not claim

- Box SUCCESS / same_three_numbers_across_surfaces until Layer B above is recorded with auth API/UI.
- Vitest green ≠ product PASS.

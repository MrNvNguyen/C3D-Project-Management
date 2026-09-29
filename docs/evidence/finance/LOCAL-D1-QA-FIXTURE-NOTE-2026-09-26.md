# Local D1 leftover QA phiếu (not production)

**Scope:** local wrangler D1 only (`.wrangler/state/v3/d1`). **Do not** run against production.

Wave G harness left a processing fixture on project **5**, payment_id **29**, description `QA Wave G reconcile fixture` (amount 1_100_000 / VAT 10 / fee 30 → booked 700_000). Residual-polish QA added `QA-G-PSR-*` (e.g. payment_id **32**). Earlier Wave D spots also created phiếu under sub-tab **Chung**.

This is fixture pile, not a product defect. Optional local cleanup is ops: delete those rows in the local D1 viewer / `wrangler d1 execute --local` if you want a clean Chung tab. No repo script is provided so it cannot be pointed at remote D1 by accident.

Evidence: `docs/evidence/finance/wave-g-impact-reconcile-q1q2-2026-09-26.json` (`payment_id` 29).

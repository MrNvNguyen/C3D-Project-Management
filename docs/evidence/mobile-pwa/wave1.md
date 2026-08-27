# Mobile PWA — Wave 1 evidence (2026-08-26)

## Scope label

**Engineering smoke (touch shell)** — coarse pointer reveal + phone modal/notif + desktop hover intact.  
**Not** full product PASS until PO taps chat delete / model ⋮ / notif on device.

## Lever

CSS `@media (pointer: coarse)` + `@media (max-width: 767px)` modal/notif sheet. No API / `finance.ts`.

## Results

| Check | Result |
|-------|--------|
| Coarse: group-hover / chat delete / st-actions visible | PASS |
| Hit target delete ≥44px | PASS |
| Phone tsBulkModal width ≤390, min-width 0 | PASS |
| Phone notif sheet full-width | PASS |
| Desktop: actions hidden until hover; hover reveals | PASS |
| Desktop sidebar 260 / no bottom nav / modal-wide 560 | PASS |

Harness: `node scripts/smoke-mobile-pwa-wave1.mjs` → `wave1-smoke-results.json` (16/16).

| File | Bytes | SHA-256 |
|------|------:|---------|
| `wave1-phone-390.png` | 40758 | `9B26C6D8D6E4859BD3CA47353A00A5C7B440EFF221C83342FCA802C84D18E67C` |
| `wave1-desktop-1280.png` | 59705 | `CD6834DAF44C8F657AC38FB414B108388D34B0773E5BEA00844866448F6B991B` |

## Files touched

- `public/index.html` (Wave 1 CSS + `modal-wide` on tsBulkModal)
- `public/static/app.js` (tabindex on nav-item for mini tooltip focus)

**Not touched:** `src/finance.ts`, `executive-dashboard.js`, v2 forks.

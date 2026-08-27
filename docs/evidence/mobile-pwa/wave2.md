# Mobile PWA — Wave 2 evidence (2026-08-26)

## Scope label

**Engineering smoke (card lists)** — phone shows cards / hides tables; desktop opposite.  
**Not** product PASS until PO confirms hours/status on Timesheet cards match table after login.

## Lever

Dual paint from same in-memory page slices (`taskPaginatedData` / `tsPaginatedData` / leave `pageData` / dashboard overdue slice). No second API. No `finance.ts`.

## Results (13/13)

| Check | Result |
|-------|--------|
| Phone: desk tables hidden, cards visible | PASS |
| Phone: sticky “Đăng ký nghỉ” CTA | PASS |
| Phone: KPI ≥2 columns | PASS |
| Desktop: tables visible, cards + sticky hidden | PASS |
| Desktop sidebar 260 / no bottom nav | PASS |
| `renderTasksMobileCards` / `renderTsMobileCards` / `renderLeaveMobileCards` present | PASS |

Harness: `node scripts/smoke-mobile-pwa-wave2.mjs`

| File | Bytes | SHA-256 |
|------|------:|---------|
| `wave2-phone-390.png` | 46233 | `7AAA8B73E1C594C87A8B9C5BF5356E147447FC38AD2CC21F290288170FAAD74F` |
| `wave2-desktop-1280.png` | 129393 | `B7BE88202BD484976F644EA15A40721BDA5FF7160E627221B67A149DFFD6B17B` |

## Files touched

- `public/index.html` — card containers, sticky leave CTA, Wave 2 CSS
- `public/static/app.js` — mobile card renderers hooked into existing row renders

**Not touched:** `src/finance.ts`, `executive-dashboard.js`, v2 forks.

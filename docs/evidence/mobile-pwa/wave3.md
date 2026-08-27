# Mobile PWA — Wave 3 evidence (2026-08-26)

## Scope label

**Engineering smoke** — legal tab scroll, chat dvh on phone, Gantt sticky label; desktop heights/980 preserved.  
**Not** product PASS until PO switches legal tabs + scrolls chat/Gantt on device.

## Lever

CSS `tabs-scroll-row` + phone chat `dvh` + Gantt sticky label / swipe hint. No API / `finance.ts`.

## Results (16/16)

| Check | Result |
|-------|--------|
| Legal 6 tabs overflow-x + nowrap (scrollWidth > client) | PASS |
| Phone: Gantt label sticky + swipe hint | PASS |
| Phone: chat panel not fixed 520 (dvh cap) | PASS |
| Desktop: chat-wrap 500 / project panel 520 | PASS |
| Desktop: work-summary min-width 980 | PASS |
| Desktop: sidebar 260 / no bottom nav / no sticky label | PASS |

Harness: `node scripts/smoke-mobile-pwa-wave3.mjs`

| File | Bytes | SHA-256 |
|------|------:|---------|
| `wave3-phone-390.png` | 44013 | `13ADFB1942C1E20D2C0F1B6C44C42BB4D8006441A4A4277F85A6F2FBBF069F0D` |
| `wave3-desktop-1280.png` | 123545 | `1E7E94EF8831D51328D8BD05FC6881D5A6AC2771A0F68507240B9D12E2535734` |

## Files touched

- `public/index.html` — Wave 3 CSS, legal/task-detail tabs scroll
- `public/static/app.js` — Gantt sticky markup, chat dvh, project tabs/chat panel class

**Not touched:** `src/finance.ts`, `executive-dashboard.js`, v2 forks.

# Mobile PWA — Wave 0 evidence (2026-08-26)

## Scope label

**Engineering smoke (shell)** — dual viewport CSS + static PWA assets on local `http://127.0.0.1:8788`.  
**Not** binding product PASS: logged-in member/admin bottom-tab role matrix and A2HS on device still need Layer B with auth.

## Fingerprint

| Field | Value |
|-------|--------|
| Box | `mobile-pwa-2026-08` / wave `mobile-pwa-w0` |
| Base URL | `http://127.0.0.1:8788` |
| Viewports | 390×844 · 1280×800 |
| Harness | `node scripts/smoke-mobile-pwa-wave0.mjs` |
| Results JSON | `docs/evidence/mobile-pwa/wave0-smoke-results.json` |
| `npm test` | 20/20 PASS (`src/finance.test.ts`) — finance untouched |
| `npm run build` | PASS + `copy-public.mjs` |

## Retained bars (verified in smoke)

| Bar | Result |
|-----|--------|
| Desktop sidebar 260px @1280 | PASS |
| Desktop main `margin-left: 260px` | PASS |
| No bottom nav @≥768 | PASS |
| SW no `/api/*` cache; no precache `index.html`/`app.js` | PASS |
| `CACHE_NAME=bim-sw-v2` | PASS |
| Manifest 192+512, theme `#00A651` | PASS |
| Phone bottom nav `display:flex` | PASS |
| Drawer `.mobile-open` left≈0 + scrim | PASS |
| Viewport without `maximum-scale=1` | PASS |

## Screenshots (paths + digests — open locally)

Regenerate: `node scripts/smoke-mobile-pwa-wave0.mjs` (requires local pages on 8788).

| File | Bytes | SHA-256 |
|------|------:|---------|
| `wave0-phone-390.png` | 41761 | `8E448DC573D317EBC55AF138685BBE60387EFBAAF805CEEE869227F9A837561C` |
| `wave0-phone-drawer-open.png` | 51153 | `681949881030CB31428DDE02BAACE1DD057A1B270FCD4F7A555AC059FED4CB83` |
| `wave0-desktop-1280.png` | 123545 | `1E7E94EF8831D51328D8BD05FC6881D5A6AC2771A0F68507240B9D12E2535734` |
| `wave0-smoke-results.json` | 2838 | `9B506C068AD2D2CBEA18E75994F4E8E7A3E453801A2F374A6D6D59743435BC10` |

**Product PASS (login roles):** confirmed by user 2026-08-26 → Wave 1 authorized. 

## Files touched (Wave 0)

- `public/index.html`, `public/static/app.js`, `public/sw.js`, `public/manifest.webmanifest`
- `public/icon-192.png`, `public/icon-512.png`, `public/badge-72.png`
- `src/index.tsx` (serve manifest + icon-512)
- `scripts/copy-public.mjs`, `scripts/preview-watch.mjs`
- `scripts/smoke-mobile-pwa-wave0.mjs` (verify only)

**Not touched:** `src/finance.ts`, `executive-dashboard.js`, `app.v2.js`, `style.v2.css`

# Mobile PWA — Wave 5 evidence (2026-08-26)

## Scope

Engineering smoke + **auto product PASS** (user: auto-pass đến hoàn thành).

## Lever

- Vietnamese dismissible install banner (`#pwaInstallBanner`) — phone only; hidden ≥768
- `beforeinstallprompt` + iOS “Thêm vào Màn hình chính” tip
- SW `CACHE_NAME=bim-sw-v4` (icon refresh) + `skipWaiting` / activate cleanup
- Icons: official OneCAD logo + label **BIM** (`scripts/gen-pwa-icons.mjs` ← `onecadvn.com/.../logo.png`)
- Still **no** precache of `index.html` / `app.js`; **no** `/api/*` cache

Regenerate icons: `node scripts/gen-pwa-icons.mjs` (needs logo at `scripts/.tmp-icons/onecad-logo.png`).

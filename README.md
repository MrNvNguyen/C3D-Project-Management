# BIM Project Management

Web quản lý dự án BIM — Hono + Cloudflare D1 + SPA.

## Cài đặt

```bash
npm install
```

## Chạy thử trước khi deploy (khuyến nghị)

Trang **Kiểm thử trước deploy** chạy smoke test trên **D1 local** — không truy cập D1 Cloudflare production.

```bash
npm run db:migrate:local   # lần đầu hoặc khi có migration mới
npm run db:seed            # dữ liệu mẫu (tùy chọn)
npm run db:seed:test       # tài khoản test — hash mật khẩu đúng
npm run preview:watch      # khuyến nghị: auto rebuild + live-reload, D1 local, port 8788
# hoặc một lần (không watch):
npm run preview:local
```

Mở trình duyệt: **http://localhost:8788/preview**

- `preview:watch` — sửa `src/` hoặc `public/` → rebuild + trình duyệt tự reload.
- Local cần `JWT_SECRET`: file `.dev.vars` (copy từ `.dev.vars.example`) hoặc script `preview:local` đã gắn `--binding`.
- Nhấn **Chạy smoke test** — kiểm `/health`, login, `/api/projects`, finance spot.
- Mở **App chính** để kiểm UI thủ công.
- Trang `/preview` **chỉ hiện trên localhost** — không có trên production.
- Chỉ dùng **D1 local** (không `--remote`).

## Dev nhanh (Vite HMR)

```bash
npm run dev
```

## Test

```bash
npm test
```

## Deploy production

```bash
npm run deploy
wrangler d1 migrations apply bim-management-production
```

## Types (Wrangler)

```bash
npm run cf-typegen
```

Pass `CloudflareBindings` as generics when instantiating Hono:

```ts
const app = new Hono<{ Bindings: CloudflareBindings }>()
```

# Tier 0 — Ops gate (2026-08-29)

**Phạm vi:** Ops / đo prod. Không sửa code.

## Kết quả lệnh trong môi trường agent

| Kiểm tra | Kết quả |
|----------|---------|
| `wrangler d1 migrations list … --local` | ✅ No migrations to apply (0047 local OK) |
| `wrangler d1 migrations list … --remote` | **NOT_MEASURED** — cần `CLOUDFLARE_API_TOKEN` / `wrangler login` |
| `wrangler whoami` | Not authenticated |
| `ALLOW_SYSTEM_INIT` trên prod | **NOT_MEASURED** — PO/ops kiểm tra Cloudflare Pages → Environment variables; nếu `=1` → **tắt ngay** |
| D1 Insights top `queryDigest` by rowsRead | **NOT_MEASURED** |
| `COUNT(*)` tasks / timesheets / notifications / messages trên prod | **NOT_MEASURED** |

## Hành động PO/ops (ngoài repo)

```bash
# 1. Xác nhận ALLOW_SYSTEM_INIT ≠ 1 trên prod
# 2. Migrations remote
npx wrangler d1 migrations list bim-management-production --remote
npx wrangler d1 migrations apply bim-management-production --remote   # nếu 0047/0048 pending
# 3. Insights
npx wrangler d1 insights bim-management-production --sort-by reads
# 4. COUNT bảng nóng (qua wrangler d1 execute --remote)
```

## Cổng ra Tier 0

Code Tier 1+ vẫn triển khai được; cổng đo prod **chưa đóng** cho đến khi PO chạy checklist trên.

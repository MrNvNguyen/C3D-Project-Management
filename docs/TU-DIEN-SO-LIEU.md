# Từ điển số liệu BIM Project Management

Tài liệu chốt **một nguồn sự thật** cho tiền, công, tiến độ. UI chỉ định dạng; không tính lại VAT/phí/tiến độ.

Cần kế toán / PO ký trước khi tin số trên dashboard sau khi đổi công thức hiển thị.

## Tiền

| Chỉ số | Nguồn | Công thức | Cấm dùng |
|---|---|---|---|
| Nghiệm thu (acceptance) | `payment_requests.amount` | Giá trị nghiệm thu / theo HĐ | Không lấy `project_revenues.amount` |
| Dòng tiền (cash) | `payment_requests.paid_amount` | Số đã thu thực tế | Không cộng vào doanh thu vào sổ |
| Doanh thu vào sổ (booked) | `project_revenues.amount` | `syncPaymentToRevenue`: trước VAT = nghiệm thu / (1 + vat%/100); sau phí QL = trước VAT × (1 − fee%/100) | Không tính lại trong `app.js` |
| Trước VAT | API `amount_before_vat` | Cùng hàm `computeBookedRevenue` | Không tự chia ở client |
| Ngân sách dự án | API `project_budget` | `contract_value × (1 − management_fee_pct/100)` | `projects.budget` (cột legacy, luôn coi = 0) |
| Chi phí trực tiếp | `project_costs` (không `salary`) | SUM(amount) | — |
| Chi phí lương | Timesheet đã ghi × `monthly_labor_costs` (phân bổ theo giờ quy đổi) | Xem `computeProjectLaborFromTimesheets` | Không đọc `project_labor_costs` cho KPI (bảng đó chỉ cache đồng bộ tay) |
| Chi phí chung | `shared_cost_allocations.allocated_amount` | — | — |

Ba số phải tách trên mọi báo cáo: **nghiệm thu**, **doanh thu vào sổ**, **dòng tiền**.

## Công / phép / timesheet

| Chỉ số | Nguồn | Quy tắc |
|---|---|---|
| Timesheet công việc | `timesheets` `day_type='work'` | UNIQUE `(user_id, project_id, work_date)` — một người một dự án một ngày |
| Ngày nghỉ | `timesheets` `project_id IS NULL` | UNIQUE `(user_id, work_date) WHERE project_id IS NULL` — không đè hàng công việc |
| Phép đã dùng | `leave_balances.used_days` | Luôn ghi bởi `recalcUsedDays()` từ đơn `approved` |

## Tiến độ và sức khỏe

| Chỉ số | Nguồn | Quy tắc |
|---|---|---|
| Tiến độ KPI | Đếm task: done = `completed` hoặc `review`; mẫu = không `cancelled` | Không dùng `projects.progress` / `tasks.is_overdue` làm số chính |
| `projects.progress` | PM nhập tay | Chỉ hiển thị khi gắn nhãn đánh giá PM |
| `health_score` (PMO) | `project_health.health_score` | Điểm **chủ quan của PM** (`pm_score`) |
| Điểm tính toán | Analytics từ task/chi phí/hạn | `computed_score` — không trộn widget với `pm_score` |

## Schema

Bảng tài chính (`monthly_labor_costs`, `project_labor_costs`, `shared_costs`, `shared_cost_allocations`, `timesheet_tasks`, `system_settings`) nằm trong migration `0043+`. Không khởi tạo / xóa dữ liệu qua `POST /api/system/init` trên production (`ALLOW_SYSTEM_INIT=1` chỉ cho DB local).

Đối soát: `GET /api/finance/revenue-audit` (orphans / lệch công thức), `GET /api/leave-balances/audit`. Blob (avatar, chat, legal) lưu R2 khi bind `FILES`; API list không trả base64.

## Ai được xem số tiền

Chỉ `system_admin` (và API PMO đã gắn `pmoAccess`) cho doanh thu / hợp đồng / chi phí. Member xem tiến độ công việc, không xem KPI tiền trên dashboard nếu backend đã tách — kiểm tra từng endpoint khi siết RBAC.

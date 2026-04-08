# OneCad BIM - Hệ Thống Quản Lý Dự Án BIM Chuyên Nghiệp

<div align="center">
  <img src="https://onecadvn.com/Upload/images/logo/logo.png" alt="OneCad Logo" height="60">
  <h3>OneCad BIM Project Management System</h3>
  <p>Hệ thống quản lý dự án BIM toàn diện cho tư vấn thiết kế xây dựng</p>
</div>

---

## 📋 Tổng quan dự án

**OneCad BIM** là web application quản lý dự án BIM chuyên nghiệp được xây dựng cho lĩnh vực tư vấn thiết kế, quản lý dự án xây dựng (công trình, hạ tầng, giao thông, năng lượng).

### 🎯 Tính năng chính

#### 🏗️ Công cụ 1: Quản lý Dự án
- ✅ **Phân quyền 4 cấp**: System Admin → Project Admin → Project Leader → Member
- ✅ **Quản lý dự án**: Tạo, chỉnh sửa, theo dõi tiến độ dự án
- ✅ **Hạng mục & Task**: Tạo hạng mục, phân công nhiệm vụ với bộ môn chuẩn BIM
- ✅ **Timesheet**: Chấm công hàng ngày (giờ HC + tăng ca), phê duyệt
- ✅ **Dashboard**: KPI cards, biểu đồ năng suất, Gantt chart, cảnh báo trễ hạn
- ✅ **Thông báo**: Real-time notifications cho task, dự án

#### 💰 Công cụ 2: Quản lý Chi phí (System Admin)
- ✅ **Chi phí riêng dự án**: Theo dõi chi phí riêng từng dự án (vật liệu, thiết bị, đi lại...)
- ✅ **Chi phí chung (Shared Costs)**: Khai báo chi phí áp dụng nhiều dự án (điện, nước, văn phòng...)
  - **Phân bổ theo % GTHĐ**: Tự động tính % theo giá trị hợp đồng mỗi dự án
  - **Chia đều (Equal split)**: Chia đều cho tất cả dự án được chọn
  - **Thủ công (Manual %)**: Nhập tay % phân bổ từng dự án (tổng = 100%)
  - **Preview real-time**: Xem trước số tiền phân bổ trước khi lưu
- ✅ **Doanh thu**: Theo dõi doanh thu từng đợt thanh toán
- ✅ **Dashboard tài chính**: Biểu đồ doanh thu/chi phí/lợi nhuận (bao gồm chi phí chung)
- ✅ **Phân tích chi tiết**: Phân tích theo dự án/tháng/năm với breakdown chi tiết
- ✅ **Tổng hợp từ Timesheet**: Liên kết với module quản lý dự án

#### 📦 Công cụ 3: Quản lý Tài sản & Khấu hao (System Admin)
- ✅ **Tài sản thiết bị**: Máy tính, laptop, phần mềm, thiết bị, phương tiện
- ✅ **Theo dõi sử dụng**: Giao tài sản cho nhân viên
- ✅ **Thống kê giá trị**: Tổng giá trị theo phòng ban, trạng thái
- ✅ **Khấu hao tự động**: Tính khấu hao đường thẳng 3 năm hoặc 5 năm
  - **Preview realtime**: Hiển thị ngay KH/tháng, KH/năm khi nhập giá mua
  - **Lịch khấu hao chi tiết**: Xem từng tháng: số tiền KH, lũy kế, giá trị còn lại
  - **Dashboard khấu hao**: KPI tổng tài sản đang KH, KH/tháng, chờ phân bổ
  - **Phân bổ vào Chi phí chung**: 1 click tạo Shared Cost = tổng KH tháng, chia đều cho tất cả dự án active
  - **Kiểm soát trạng thái**: Theo dõi từng tháng đã phân bổ hay chưa, badge cảnh báo
  - **Tích hợp tài chính**: Khấu hao hiện trực tiếp trong module Chi phí chung & Tài chính dự án

### 🔖 Bộ môn chuẩn BIM
| Nhóm | Mã bộ môn |
|------|-----------|
| Kiến trúc | ZZ, AA, AD, AF |
| Kết cấu & MEP | ES, EM, EE, EP, EF, EC, MEP |
| Hạ tầng dân dụng | CL, CT, CD, CS, CW, CF, CE, CC |
| Cảnh quan | LA, LW, LD, LR, LE, LL |

---

## 🚀 Tài khoản Demo

| Tài khoản | Mật khẩu | Vai trò | Quyền hạn |
|-----------|----------|---------|-----------|
| `admin` | `Admin@123` | System Admin | Toàn quyền hệ thống |
| `pham.thi.d` | `Pass@123` | Project Admin | Quản lý dự án + nhân sự |
| `le.van.c` | `Pass@123` | Project Leader | Theo dõi + báo cáo |
| `nguyen.van.a` | `Pass@123` | Member | Task + Timesheet |

---

## 🌐 URLs

- **Application**: https://3000-i6ab5bzz68gjjlncohvbf-0e616f0a.sandbox.novita.ai/
- **API Base**: https://3000-i6ab5bzz68gjjlncohvbf-0e616f0a.sandbox.novita.ai/api/

### API Endpoints chính
```
POST /api/auth/login          - Đăng nhập
GET  /api/auth/me             - Thông tin user hiện tại
POST /api/auth/change-password - Đổi mật khẩu

GET  /api/projects            - Danh sách dự án
POST /api/projects            - Tạo dự án
GET  /api/projects/:id        - Chi tiết dự án
POST /api/projects/:id/members - Thêm thành viên

GET  /api/tasks               - Danh sách task
POST /api/tasks               - Tạo task
PUT  /api/tasks/:id           - Cập nhật task

GET  /api/timesheets          - Danh sách timesheet
POST /api/timesheets          - Thêm timesheet

GET  /api/costs               - Chi phí riêng (Admin)
GET  /api/revenues            - Doanh thu (Admin)
GET  /api/shared-costs        - Chi phí chung (Admin)
POST /api/shared-costs        - Tạo chi phí chung + phân bổ tự động
PUT  /api/shared-costs/:id    - Cập nhật + tái phân bổ
DELETE /api/shared-costs/:id  - Xóa chi phí chung
GET  /api/shared-costs/summary?year=YYYY - Tổng hợp phân bổ theo dự án
GET  /api/assets              - Tài sản (Admin)
GET  /api/users               - Nhân sự (Admin)

GET  /api/dashboard/stats     - Dashboard tổng hợp
GET  /api/disciplines         - Danh mục bộ môn

GET  /api/depreciation/summary?year=YYYY          - Tổng hợp khấu hao theo năm (Admin)
GET  /api/depreciation/monthly-unallocated        - Các tháng chưa phân bổ (Admin)
GET  /api/assets/:id/depreciation?year=YYYY       - Lịch khấu hao từng tài sản (Admin)
POST /api/assets/:id/depreciation/setup           - Cài đặt/cập nhật khấu hao tài sản (Admin)
POST /api/depreciation/allocate-to-shared-cost    - Phân bổ KH tháng vào chi phí chung (Admin)
```

---

## 🏛️ Kiến trúc hệ thống

### Technology Stack
- **Backend**: Hono.js (TypeScript) trên Cloudflare Workers
- **Frontend**: HTML5 + TailwindCSS + Chart.js + Axios
- **Database**: Cloudflare D1 (SQLite distributed)
- **Authentication**: JWT (HMAC-SHA256) tự cài đặt
- **Deployment**: Cloudflare Pages

### Cấu trúc thư mục
```
webapp/
├── src/
│   └── index.tsx          # Main API (Hono backend)
├── public/
│   ├── index.html         # SPA Frontend
│   ├── static/
│   │   └── app.js         # Frontend JavaScript (~82KB)
│   └── _routes.json       # Cloudflare Pages routes
├── migrations/
│   ├── 0001_initial_schema.sql  # Database schema
│   └── 0002_seed_data.sql       # Sample data
├── dist/                  # Build output
├── ecosystem.config.cjs   # PM2 configuration
├── wrangler.jsonc         # Cloudflare configuration
└── vite.config.ts         # Build configuration
```

### Mô hình dữ liệu
| Bảng | Mô tả |
|------|-------|
| `users` | Tài khoản người dùng, phân quyền |
| `projects` | Thông tin dự án |
| `project_members` | Thành viên trong dự án |
| `disciplines` | Danh mục bộ môn BIM |
| `categories` | Hạng mục công việc |
| `tasks` | Nhiệm vụ cụ thể |
| `task_history` | Lịch sử thay đổi task |
| `timesheets` | Bảng chấm công |
| `project_costs` | Chi phí riêng từng dự án |
| `project_revenues` | Doanh thu dự án |
| `shared_costs` | Chi phí chung (áp dụng nhiều dự án) |
| `shared_cost_allocations` | Phân bổ chi phí chung về từng dự án |
| `assets` | Tài sản thiết bị |
| `notifications` | Thông báo |

---

## 🔧 Hướng dẫn triển khai

### Môi trường Local (Sandbox)
```bash
# 1. Cài đặt dependencies
cd /home/user/webapp && npm install

# 2. Build project
npm run build

# 3. Khởi động server
pm2 start ecosystem.config.cjs

# 4. Khởi tạo database + dữ liệu mẫu
curl -X POST http://localhost:3000/api/system/init
```

### Triển khai Cloudflare Pages
```bash
# 1. Đăng nhập Cloudflare
npx wrangler login

# 2. Tạo D1 database
npx wrangler d1 create bim-management-production
# Cập nhật database_id vào wrangler.jsonc

# 3. Apply migrations
npx wrangler d1 migrations apply bim-management-production

# 4. Deploy
npm run deploy
```

---

## 📊 Dashboard Features

### KPI Cards
- Tổng dự án / Đang hoạt động
- Tổng task / Đã hoàn thành
- Task trễ hạn (cảnh báo đỏ)
- Tỷ lệ hoàn thành (%)

### Charts
- **Bar Chart**: Năng suất nhân sự (task hoàn thành + giờ làm)
- **Doughnut Chart**: Phân bổ task theo bộ môn BIM
- **Line Chart**: Xu hướng giờ làm việc theo tháng
- **Gantt Chart**: Timeline tiến độ dự án
- **Progress Bars**: Tiến độ từng dự án với cảnh báo màu

### Quản lý Chi phí Dashboard
- **Bar Chart**: Doanh thu vs Chi phí theo dự án
- **Line Chart**: Xu hướng tài chính theo tháng
- KPI: Tổng doanh thu, chi phí, lợi nhuận, tỷ suất

---

## 🎨 Design System

### Màu sắc
| Biến | Mã màu | Dùng cho |
|------|--------|----------|
| Primary | `#00A651` | OneCad green, buttons, badges |
| Accent | `#0066CC` | CTA buttons, links |
| Warning | `#FF6B00` | Task trễ hạn |
| Danger | `#EF4444` | Delete, critical |

### Components
- Task cards với status badge màu sắc
- Timeline Gantt với today marker (đỏ)
- Progress bars gradient xanh/đỏ
- Data tables sortable với overdue-row highlight
- Modal forms cho CRUD
- Toast notifications slide-in
- Notification dropdown với unread badge

---

## 📈 Trạng thái phát triển

### ✅ Đã hoàn thành
- [x] Authentication JWT với 4 cấp quyền
- [x] CRUD đầy đủ: Projects, Tasks, Categories, Members
- [x] Timesheet với phê duyệt
- [x] **Working Days Calculation**: Tính chính xác số ngày làm việc
  - Ngày làm việc thông thường (work): 1 ngày
  - Đi công tác (business_trip): 1 ngày
  - Nghỉ nửa ngày (half_day_am/half_day_pm): 0.5 ngày
  - Các loại nghỉ khác (annual_leave, sick_leave, etc.): 0 ngày
- [x] Dashboard với 6 loại charts
- [x] Gantt chart timeline
- [x] Quản lý chi phí & doanh thu
- [x] Quản lý tài sản
- [x] **Khấu hao tài sản**: Tính KH đường thẳng 3/5 năm, lịch từng tháng, phân bổ vào chi phí chung
- [x] Quản lý nhân sự
- [x] Notifications system
- [x] Task history tracking
- [x] Responsive design

### 🚧 Có thể phát triển thêm
- [ ] Export báo cáo Excel/PDF
- [ ] Email notifications
- [ ] File attachments cho tasks
- [ ] Multi-language support
- [ ] Mobile app (React Native)
- [ ] BIM model viewer integration
- [ ] Advanced analytics & reporting
- [ ] Workflow automation

---

## 💻 Tech Stack Details

| Component | Technology | Version |
|-----------|-----------|---------|
| Runtime | Cloudflare Workers | Edge |
| Framework | Hono.js | 4.12+ |
| Build | Vite + @hono/vite-build | 6.x |
| Database | Cloudflare D1 (SQLite) | - |
| CSS | TailwindCSS CDN | 3.x |
| Charts | Chart.js | 4.4 |
| HTTP Client | Axios | 1.6 |
| Icons | FontAwesome | 6.4 |
| Date | Day.js | 1.11 |

---

**© 2024 OneCad Vietnam - BIM Project Management System**  
*Được xây dựng trên nền tảng Cloudflare Workers + Hono.js*

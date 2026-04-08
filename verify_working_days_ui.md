# Hướng Dẫn Test Working Days Calculation

## Các loại ngày và cách tính

| Loại ngày | Mã (day_type) | Số ngày tính | Giải thích |
|-----------|---------------|--------------|------------|
| Làm việc bình thường | `work` | **1.0 ngày** | Ngày làm việc đầy đủ 8 giờ |
| Đi công tác | `business_trip` | **1.0 ngày** | Vẫn là ngày làm việc, chỉ là làm ở địa điểm khác |
| Nghỉ nửa ngày sáng | `half_day_am` | **0.5 ngày** | Nghỉ buổi sáng, làm buổi chiều (4h) |
| Nghỉ nửa ngày chiều | `half_day_pm` | **0.5 ngày** | Làm buổi sáng, nghỉ buổi chiều (4h) |
| Nghỉ phép năm | `annual_leave` | **0 ngày** | Không tính vào ngày làm việc |
| Nghỉ không lương | `unpaid_leave` | **0 ngày** | Không tính vào ngày làm việc |
| Nghỉ lễ | `holiday` | **0 ngày** | Không tính vào ngày làm việc |
| Nghỉ ốm | `sick_leave` | **0 ngày** | Không tính vào ngày làm việc |
| Nghỉ bù | `compensatory` | **0 ngày** | Không tính vào ngày làm việc |

## Test Case đã thực hiện (Tháng 4/2026)

Đã tạo 5 timesheet entries:
1. 01/04/2026 - Làm việc bình thường (8h) → 1 ngày
2. 02/04/2026 - Đi công tác (8h) → 1 ngày
3. 03/04/2026 - Nghỉ nửa ngày sáng (4h) → 0.5 ngày
4. 04/04/2026 - Nghỉ nửa ngày chiều (4h) → 0.5 ngày
5. 05/04/2026 - Nghỉ phép năm (0h) → 0 ngày

**Tổng số records**: 5  
**Tổng giờ làm việc**: 24 giờ (8+8+4+4+0)  
**Working Days (expected)**: **3.0 ngày** (1+1+0.5+0.5+0)

## Cách kiểm tra trên UI

### 1. Đăng nhập với tài khoản admin
- Username: `admin`
- Password: `Admin@123`

### 2. Vào trang Quản lý Timesheet
- Menu bên trái → Timesheet

### 3. Chọn tháng 4/2026 để xem dữ liệu test

### 4. Kiểm tra summary statistics
- Phần header trên cùng sẽ hiển thị:
  - **Tổng giờ**: 24h
  - **Working Days**: **3** (hoặc 3.0)

### 5. Kiểm tra từng dòng timesheet
- Mỗi dòng sẽ có badge màu khác nhau theo loại ngày
- Verify badge text và màu sắc

## SQL Query để verify

```sql
SELECT 
  work_date,
  day_type,
  regular_hours,
  CASE 
    WHEN day_type IN ('work', 'business_trip') THEN 1 
    WHEN day_type IN ('half_day_am', 'half_day_pm') THEN 0.5 
    ELSE 0 
  END as counted_days
FROM timesheets 
WHERE strftime('%Y-%m', work_date) = '2026-04'
ORDER BY work_date;
```

## API Endpoint để test

```bash
# Get summary for April 2026
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "http://localhost:3000/api/timesheets/summary?month=04&year=2026"
  
# Expected response:
# {
#   "working_days": 3,
#   "total_hours": 24,
#   ...
# }
```


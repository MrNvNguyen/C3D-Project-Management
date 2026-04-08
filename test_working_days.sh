#!/bin/bash

# Test working days calculation
# 1. Login as admin
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

echo "✅ Login successful, token: ${TOKEN:0:20}..."

# 2. Get user_id for testing
USER_ID=$(curl -s -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/auth/me | grep -o '"id":[0-9]*' | head -1 | cut -d':' -f2)
echo "✅ User ID: $USER_ID"

# 3. Create test timesheets with different day_types
echo ""
echo "📝 Creating test timesheets..."

# Ngày làm việc bình thường (work) - should count as 1 day
curl -s -X POST http://localhost:3000/api/timesheets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"work_date":"2026-04-01","day_type":"work","project_id":1,"regular_hours":8,"overtime_hours":0}' > /dev/null
echo "✅ Created: Ngày làm việc bình thường (2026-04-01) - should count as 1 day"

# Đi công tác (business_trip) - should count as 1 day
curl -s -X POST http://localhost:3000/api/timesheets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"work_date":"2026-04-02","day_type":"business_trip","project_id":1,"regular_hours":8,"overtime_hours":0}' > /dev/null
echo "✅ Created: Đi công tác (2026-04-02) - should count as 1 day"

# Nghỉ nửa ngày sáng (half_day_am) - should count as 0.5 day
curl -s -X POST http://localhost:3000/api/timesheets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"work_date":"2026-04-03","day_type":"half_day_am","project_id":1,"regular_hours":4,"overtime_hours":0}' > /dev/null
echo "✅ Created: Nghỉ nửa ngày sáng (2026-04-03) - should count as 0.5 day"

# Nghỉ nửa ngày chiều (half_day_pm) - should count as 0.5 day
curl -s -X POST http://localhost:3000/api/timesheets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"work_date":"2026-04-04","day_type":"half_day_pm","project_id":1,"regular_hours":4,"overtime_hours":0}' > /dev/null
echo "✅ Created: Nghỉ nửa ngày chiều (2026-04-04) - should count as 0.5 day"

# Nghỉ phép (annual_leave) - should count as 0 day
curl -s -X POST http://localhost:3000/api/timesheets \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"work_date":"2026-04-05","day_type":"annual_leave","regular_hours":0,"overtime_hours":0}' > /dev/null
echo "✅ Created: Nghỉ phép (2026-04-05) - should count as 0 day"

# 4. Check stats
echo ""
echo "📊 Checking working_days calculation..."
STATS=$(curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/timesheets/stats?month=04&year=2026&user_id=$USER_ID")
echo "$STATS" | python3 -m json.tool 2>/dev/null || echo "$STATS"

echo ""
echo "Expected working_days: 3.0 (1 + 1 + 0.5 + 0.5 + 0)"


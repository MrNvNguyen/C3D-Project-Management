#!/bin/bash

TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"Admin@123"}' | grep -o '"token":"[^"]*' | cut -d'"' -f4)

echo "✅ Testing working_days calculation"
echo ""

# Check summary endpoint
echo "📊 /api/timesheets/summary (month=04, year=2026)"
curl -s -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/timesheets/summary?month=04&year=2026" | python3 -m json.tool


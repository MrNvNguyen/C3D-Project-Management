-- Local test users — chỉ dùng với: wrangler d1 execute ... --local
-- Mật khẩu: admin → Admin@123456 | còn lại → Bim@2024

INSERT INTO users (username, password_hash, full_name, email, role, department, salary_monthly, is_active)
VALUES ('admin', '9b821c1fb018202d4e4198cbca970f6f5548c9b14ff2d52b302a7a9361905eb2', 'System Administrator', 'admin@onecad.vn', 'system_admin', 'Quản lý hệ thống', 0, 1)
ON CONFLICT(username) DO UPDATE SET
  password_hash = excluded.password_hash,
  role = excluded.role,
  full_name = excluded.full_name,
  is_active = 1;

INSERT INTO users (username, password_hash, full_name, email, role, department, salary_monthly, is_active) VALUES
  ('nguyen.van.a', '649186638ea9993caaef8dc55484d8f424d8cdfde90bcaa0997c095aa9597534', 'Nguyễn Văn A', 'nva@onecad.vn', 'member', 'Kiến trúc', 15000000, 1),
  ('tran.thi.b',   '649186638ea9993caaef8dc55484d8f424d8cdfde90bcaa0997c095aa9597534', 'Trần Thị B',   'ttb@onecad.vn', 'member', 'Kết cấu', 16000000, 1),
  ('le.van.c',     '649186638ea9993caaef8dc55484d8f424d8cdfde90bcaa0997c095aa9597534', 'Lê Văn C',     'lvc@onecad.vn', 'project_leader', 'MEP', 18000000, 1),
  ('pham.thi.d',   '649186638ea9993caaef8dc55484d8f424d8cdfde90bcaa0997c095aa9597534', 'Phạm Thị D',   'ptd@onecad.vn', 'project_admin', 'Quản lý dự án', 22000000, 1)
ON CONFLICT(username) DO UPDATE SET
  password_hash = excluded.password_hash,
  role = excluded.role,
  full_name = excluded.full_name,
  is_active = 1;

PRAGMA foreign_keys=OFF;
BEGIN TRANSACTION;
CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO d1_migrations VALUES(1,'0001_initial_schema.sql','2026-02-24 03:34:41');
INSERT INTO d1_migrations VALUES(2,'0002_seed_data.sql','2026-02-24 03:34:42');
CREATE TABLE _cf_METADATA (
        key INTEGER PRIMARY KEY,
        value BLOB
      );
INSERT INTO _cf_METADATA VALUES(2,26385);
CREATE TABLE users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  role TEXT NOT NULL DEFAULT 'member', 
  department TEXT,
  salary_monthly REAL DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  avatar TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO users VALUES(1,'admin','$2a$10$admin_hash_placeholder_Admin123','System Administrator','admin@onecadvn.com','','system_admin','Quản lý hệ thống',0.0,1,NULL,'2026-02-24 03:34:42','2026-02-25 07:05:45');
INSERT INTO users VALUES(2,'nguyen.van.a','$2a$10$member_hash_placeholder','Nguyễn Văn A','nva@onecad.vn','','member','Kiến trúc',0.0,1,NULL,'2026-02-24 03:34:42','2026-02-24 09:22:25');
INSERT INTO users VALUES(3,'tran.thi.b','$2a$10$member_hash_placeholder','Trần Thị B','ttb@onecad.vn',NULL,'member','Kết cấu',16000000.0,1,NULL,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO users VALUES(4,'le.van.c','$2a$10$member_hash_placeholder','Lê Văn C','lvc@onecad.vn',NULL,'project_leader','MEP',18000000.0,1,NULL,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO users VALUES(5,'pham.thi.d','$2a$10$member_hash_placeholder','Phạm Thị D','ptd@onecad.vn',NULL,'project_admin','Quản lý dự án',22000000.0,1,NULL,'2026-02-24 03:34:42','2026-02-24 03:34:42');
CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  client TEXT,
  project_type TEXT DEFAULT 'building', 
  status TEXT DEFAULT 'active', 
  start_date DATE,
  end_date DATE,
  budget REAL DEFAULT 0,
  contract_value REAL DEFAULT 0,
  location TEXT,
  admin_id INTEGER,
  leader_id INTEGER,
  progress INTEGER DEFAULT 0,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id),
  FOREIGN KEY (leader_id) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
INSERT INTO projects VALUES(1,'PRJ001','Tòa nhà văn phòng OneCad Tower','Dự án thiết kế tòa nhà văn phòng 15 tầng tại Hà Nội','OneCad Vietnam','building','active','2026-01-15','2026-12-31',0.0,5000000000.0,NULL,4,3,0,1,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO projects VALUES(2,'PRJ002','Cầu vượt đường bộ QL1A','Dự án thiết kế cầu vượt tại km 45+200 QL1A','Bộ GTVT','transport','active','2026-03-01','2027-06-30',0.0,12000000000.0,NULL,4,3,0,1,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO projects VALUES(3,'PRJ003','Khu đô thị Eco City','Quy hoạch và thiết kế khu đô thị sinh thái 50ha','Eco Land JSC','building','planning','2026-06-01','2027-12-31',0.0,8000000000.0,NULL,4,3,0,1,'2026-02-24 03:34:42','2026-02-24 03:34:42');
CREATE TABLE project_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT DEFAULT 'member', 
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(project_id, user_id)
);
INSERT INTO project_members VALUES(1,1,2,'member','2026-02-24 04:13:27');
INSERT INTO project_members VALUES(2,1,3,'member','2026-02-24 04:13:32');
INSERT INTO project_members VALUES(3,1,4,'project_leader','2026-02-24 04:13:39');
INSERT INTO project_members VALUES(4,1,5,'project_admin','2026-02-24 04:13:45');
INSERT INTO project_members VALUES(5,2,4,'project_leader','2026-02-24 04:14:03');
INSERT INTO project_members VALUES(6,2,3,'member','2026-02-24 04:14:10');
INSERT INTO project_members VALUES(7,2,2,'member','2026-02-24 04:14:18');
INSERT INTO project_members VALUES(8,2,5,'project_admin','2026-02-24 04:14:23');
INSERT INTO project_members VALUES(9,3,2,'member','2026-02-24 04:14:40');
INSERT INTO project_members VALUES(10,3,3,'member','2026-02-24 04:14:47');
INSERT INTO project_members VALUES(11,3,4,'project_leader','2026-02-24 04:14:55');
INSERT INTO project_members VALUES(12,3,5,'project_admin','2026-02-24 04:15:02');
CREATE TABLE disciplines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT DEFAULT 'architecture', 
  description TEXT,
  is_active INTEGER DEFAULT 1
);
INSERT INTO disciplines VALUES(3073,'ZZ','Tổng hợp','general',NULL,1);
INSERT INTO disciplines VALUES(3074,'AA','Kiến trúc','architecture',NULL,1);
INSERT INTO disciplines VALUES(3075,'AD','Nội thất','architecture',NULL,1);
INSERT INTO disciplines VALUES(3076,'AF','Mặt dựng','architecture',NULL,1);
INSERT INTO disciplines VALUES(3077,'ES','Kết cấu','structure',NULL,1);
INSERT INTO disciplines VALUES(3078,'EM','Điều hòa thông gió','mep',NULL,1);
INSERT INTO disciplines VALUES(3079,'EE','Điện sinh hoạt','mep',NULL,1);
INSERT INTO disciplines VALUES(3080,'EP','Cấp thoát nước sinh hoạt','mep',NULL,1);
INSERT INTO disciplines VALUES(3081,'EF','Chữa cháy','mep',NULL,1);
INSERT INTO disciplines VALUES(3082,'EC','Thông tin liên lạc','mep',NULL,1);
INSERT INTO disciplines VALUES(3083,'CL','San nền','civil',NULL,1);
INSERT INTO disciplines VALUES(3084,'CT','Giao thông','civil',NULL,1);
INSERT INTO disciplines VALUES(3085,'CD','Thoát nước mưa','civil',NULL,1);
INSERT INTO disciplines VALUES(3086,'CS','Thoát nước thải','civil',NULL,1);
INSERT INTO disciplines VALUES(3087,'CW','Cấp nước','civil',NULL,1);
INSERT INTO disciplines VALUES(3088,'CF','Chữa cháy (hạ tầng)','civil',NULL,1);
INSERT INTO disciplines VALUES(3089,'CE','Điện (hạ tầng)','civil',NULL,1);
INSERT INTO disciplines VALUES(3090,'CC','Thông tin (hạ tầng)','civil',NULL,1);
INSERT INTO disciplines VALUES(3091,'LA','Cảnh quan','landscape',NULL,1);
INSERT INTO disciplines VALUES(3092,'LW','Cấp nước cảnh quan','landscape',NULL,1);
INSERT INTO disciplines VALUES(3093,'LD','Thoát nước cảnh quan','landscape',NULL,1);
INSERT INTO disciplines VALUES(3094,'LR','Tường chắn','landscape',NULL,1);
INSERT INTO disciplines VALUES(3095,'LE','Kè','landscape',NULL,1);
INSERT INTO disciplines VALUES(3096,'LL','Chiếu sáng','landscape',NULL,1);
CREATE TABLE categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  code TEXT,
  description TEXT,
  discipline_code TEXT,
  phase TEXT DEFAULT 'basic_design', 
  start_date DATE,
  end_date DATE,
  progress INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending', 
  parent_id INTEGER,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (parent_id) REFERENCES categories(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
INSERT INTO categories VALUES(1,1,'Thiết kế kiến trúc','CAT-AA',NULL,'AA','basic_design','2024-01-15','2024-04-30',0,'in_progress',NULL,4,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO categories VALUES(2,1,'Thiết kế kết cấu','CAT-ES',NULL,'ES','basic_design','2024-02-01','2024-05-31',0,'in_progress',NULL,4,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO categories VALUES(3,1,'Thiết kế MEP','CAT-MEP',NULL,'EM','basic_design','2024-03-01','2024-06-30',0,'pending',NULL,4,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO categories VALUES(4,2,'Thiết kế cầu','CAT-CT',NULL,'CT','technical_design','2024-03-01','2024-09-30',0,'in_progress',NULL,4,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO categories VALUES(5,3,'Cầu B','CauB',NULL,'CT','construction_design','2026-02-25',NULL,0,'pending',NULL,1,'2026-02-24 04:16:10','2026-02-24 04:16:10');
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  category_id INTEGER,
  title TEXT NOT NULL,
  description TEXT,
  discipline_code TEXT,
  phase TEXT DEFAULT 'basic_design',
  priority TEXT DEFAULT 'medium', 
  status TEXT DEFAULT 'todo', 
  assigned_to INTEGER,
  assigned_by INTEGER,
  start_date DATE,
  due_date DATE,
  actual_start_date DATE,
  actual_end_date DATE,
  estimated_hours REAL DEFAULT 0,
  actual_hours REAL DEFAULT 0,
  progress INTEGER DEFAULT 0,
  is_overdue INTEGER DEFAULT 0,
  tags TEXT,
  attachments TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (category_id) REFERENCES categories(id),
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id)
);
INSERT INTO tasks VALUES(1,1,1,'Vẽ mặt bằng tầng điển hình','Vẽ mặt bằng tầng 2-14 theo tiêu chuẩn BIM','AA','basic_design','high','completed',2,4,'2026-01-20','2026-02-05',NULL,'2026-02-03',40.0,0.0,100,0,NULL,NULL,'2026-02-24 03:34:42','2026-02-25 09:13:01');
INSERT INTO tasks VALUES(2,1,1,'Thiết kế mặt đứng công trình','Thiết kế 4 mặt đứng theo phong cách hiện đại','AA','basic_design','high','completed',2,4,'2026-02-01','2026-02-12',NULL,'2026-02-10',30.0,0.0,100,0,NULL,NULL,'2026-02-24 03:34:42','2026-02-25 09:12:11');
INSERT INTO tasks VALUES(3,1,2,'Tính toán móng cọc','Tính toán và thiết kế hệ móng cọc nhồi D600','ES','basic_design','urgent','completed',NULL,4,'2026-02-01','2026-02-20',NULL,'2026-02-28',24.0,0.0,100,0,NULL,NULL,'2026-02-24 03:34:42','2026-02-25 09:08:24');
INSERT INTO tasks VALUES(4,1,2,'Thiết kế khung thép tầng 1','Thiết kế hệ khung chịu lực tầng 1','ES','basic_design','medium','completed',3,4,'2026-02-05','2026-02-28',NULL,'2026-02-25',20.0,0.0,100,0,NULL,NULL,'2026-02-24 03:34:42','2026-02-25 09:40:04');
INSERT INTO tasks VALUES(5,2,4,'Khảo sát địa chất','Lập báo cáo khảo sát địa chất công trình cầu','CT','technical_design','urgent','completed',2,4,'2026-03-01','2026-02-25',NULL,'2026-02-25',16.0,0.0,100,0,NULL,NULL,'2026-02-24 03:34:42','2026-02-25 09:13:25');
INSERT INTO tasks VALUES(10,2,NULL,'Khảo sát địa chất cầu',NULL,'CT','basic_design','urgent','completed',2,4,'2026-03-01','2026-03-20',NULL,NULL,16.0,0.0,100,0,NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO tasks VALUES(289,1,NULL,'Hệ thống PCCC tầng hầm',NULL,'EF','basic_design','high','todo',4,4,'2026-04-01','2026-07-30',NULL,NULL,32.0,0.0,0,0,NULL,NULL,'2026-02-24 09:09:18','2026-02-24 09:09:18');
INSERT INTO tasks VALUES(290,2,NULL,'Thiết kế móng trụ cầu','','ES','basic_design','high','completed',3,4,'2026-02-01','2026-02-20',NULL,'2026-02-25',48.0,0.0,100,0,NULL,NULL,'2026-02-24 09:09:18','2026-02-25 09:40:41');
INSERT INTO tasks VALUES(291,1,NULL,'Thiết kế hệ thống điện tầng 1-5',NULL,'EE','basic_design','medium','todo',4,4,'2026-05-01','2026-08-30',NULL,NULL,24.0,0.0,0,0,NULL,NULL,'2026-02-24 09:09:18','2026-02-24 09:09:18');
INSERT INTO tasks VALUES(316,2,NULL,'Thiết kế mố cầu A1',NULL,'ES','basic_design','high','in_progress',3,4,'2026-03-10','2026-07-30',NULL,NULL,60.0,0.0,45,0,NULL,NULL,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO tasks VALUES(317,2,NULL,'Bản vẽ thiết kế dầm cầu','','ES','basic_design','urgent','completed',2,4,'2026-02-03','2026-02-19',NULL,'2026-02-25',48.0,0.0,100,0,NULL,NULL,'2026-02-24 15:13:27','2026-02-25 09:38:38');
INSERT INTO tasks VALUES(318,2,NULL,'Hệ thống thoát nước mặt cầu',NULL,'CD','basic_design','medium','todo',2,4,'2026-05-01','2026-09-30',NULL,NULL,32.0,0.0,0,0,NULL,NULL,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO tasks VALUES(319,3,NULL,'Quy hoạch tổng thể 50ha',NULL,'AA','basic_design','high','in_progress',2,4,'2026-06-15','2026-10-30',NULL,NULL,80.0,0.0,20,0,NULL,NULL,'2026-02-24 15:13:28','2026-02-24 15:13:28');
INSERT INTO tasks VALUES(320,3,NULL,'Thiết kế hạ tầng kỹ thuật','','CL','basic_design','medium','completed',3,4,'2026-02-01','2026-02-27',NULL,'2026-02-25',64.0,0.0,100,0,NULL,NULL,'2026-02-24 15:13:28','2026-02-25 09:39:26');
INSERT INTO tasks VALUES(321,1,NULL,'Tính toán móng cọc',NULL,'ES','basic_design','urgent','review',3,4,'2026-02-01','2026-03-30',NULL,NULL,24.0,0.0,90,0,NULL,NULL,'2026-02-25 09:08:57','2026-02-25 09:08:57');
CREATE TABLE task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  field_changed TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  comment TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
INSERT INTO task_history VALUES(15,3,1,'status','review','completed',NULL,'2026-02-25 09:08:24');
INSERT INTO task_history VALUES(16,3,1,'assigned_to','3','null',NULL,'2026-02-25 09:08:24');
INSERT INTO task_history VALUES(17,3,1,'progress','90','100',NULL,'2026-02-25 09:08:24');
INSERT INTO task_history VALUES(25,2,1,'due_date','2026-03-15','2026-02-12',NULL,'2026-02-25 09:12:00');
INSERT INTO task_history VALUES(26,2,1,'status','in_progress','completed',NULL,'2026-02-25 09:12:11');
INSERT INTO task_history VALUES(27,2,1,'progress','40','100',NULL,'2026-02-25 09:12:11');
INSERT INTO task_history VALUES(28,1,1,'status','in_progress','completed',NULL,'2026-02-25 09:13:01');
INSERT INTO task_history VALUES(29,1,1,'due_date','2026-02-28','2026-02-05',NULL,'2026-02-25 09:13:01');
INSERT INTO task_history VALUES(30,1,1,'progress','65','100',NULL,'2026-02-25 09:13:02');
INSERT INTO task_history VALUES(31,5,1,'due_date','2026-03-20','2026-02-25',NULL,'2026-02-25 09:13:25');
INSERT INTO task_history VALUES(32,317,1,'description','','',NULL,'2026-02-25 09:38:38');
INSERT INTO task_history VALUES(33,317,1,'status','in_progress','completed',NULL,'2026-02-25 09:38:38');
INSERT INTO task_history VALUES(34,317,1,'start_date','2026-04-01','2026-02-03',NULL,'2026-02-25 09:38:38');
INSERT INTO task_history VALUES(35,317,1,'due_date','2026-08-15','2026-02-19',NULL,'2026-02-25 09:38:38');
INSERT INTO task_history VALUES(36,317,1,'progress','30','100',NULL,'2026-02-25 09:38:38');
INSERT INTO task_history VALUES(37,320,1,'description','','',NULL,'2026-02-25 09:39:26');
INSERT INTO task_history VALUES(38,320,1,'status','todo','completed',NULL,'2026-02-25 09:39:26');
INSERT INTO task_history VALUES(39,320,1,'start_date','2026-07-01','2026-02-01',NULL,'2026-02-25 09:39:26');
INSERT INTO task_history VALUES(40,320,1,'due_date','2026-11-30','2026-02-27',NULL,'2026-02-25 09:39:27');
INSERT INTO task_history VALUES(41,320,1,'progress','0','100',NULL,'2026-02-25 09:39:27');
INSERT INTO task_history VALUES(42,4,1,'status','todo','completed',NULL,'2026-02-25 09:40:04');
INSERT INTO task_history VALUES(43,4,1,'start_date','2026-03-01','2026-02-05',NULL,'2026-02-25 09:40:04');
INSERT INTO task_history VALUES(44,4,1,'due_date','2026-03-30','2026-02-28',NULL,'2026-02-25 09:40:04');
INSERT INTO task_history VALUES(45,4,1,'progress','0','100',NULL,'2026-02-25 09:40:04');
INSERT INTO task_history VALUES(46,290,1,'description','','',NULL,'2026-02-25 09:40:41');
INSERT INTO task_history VALUES(47,290,1,'status','in_progress','completed',NULL,'2026-02-25 09:40:41');
INSERT INTO task_history VALUES(48,290,1,'start_date','2026-04-01','2026-02-01',NULL,'2026-02-25 09:40:41');
INSERT INTO task_history VALUES(49,290,1,'due_date','2026-07-15','2026-02-20',NULL,'2026-02-25 09:40:41');
INSERT INTO task_history VALUES(50,290,1,'progress','30','100',NULL,'2026-02-25 09:40:41');
CREATE TABLE timesheets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  project_id INTEGER NOT NULL,
  task_id INTEGER,
  work_date DATE NOT NULL,
  regular_hours REAL DEFAULT 0,
  overtime_hours REAL DEFAULT 0,
  description TEXT,
  status TEXT DEFAULT 'draft', 
  approved_by INTEGER,
  approved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (approved_by) REFERENCES users(id)
);
INSERT INTO timesheets VALUES(1,2,1,1,'2024-01-20',8.0,0.0,'Bắt đầu vẽ mặt bằng tầng 2','approved',NULL,NULL,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO timesheets VALUES(2,2,1,1,'2024-01-21',8.0,2.0,'Tiếp tục vẽ mặt bằng tầng 3-5','approved',NULL,NULL,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO timesheets VALUES(3,2,1,2,'2024-01-22',8.0,0.0,'Phác thảo mặt đứng công trình','submitted',NULL,NULL,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO timesheets VALUES(4,3,1,3,'2024-02-01',8.0,3.0,'Tính toán tải trọng móng','approved',NULL,NULL,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO timesheets VALUES(5,3,2,5,'2024-03-02',8.0,0.0,'Thực hiện khảo sát địa chất','approved',NULL,NULL,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO timesheets VALUES(6,2,1,NULL,'2026-01-26',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(7,3,1,NULL,'2026-01-26',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(8,2,1,NULL,'2026-01-27',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(9,3,1,NULL,'2026-01-27',8.0,3.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(10,2,1,NULL,'2026-01-28',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(11,3,1,NULL,'2026-01-28',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(12,2,1,NULL,'2026-01-29',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(13,3,1,NULL,'2026-01-29',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(14,2,1,NULL,'2026-01-30',8.0,2.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(15,3,1,NULL,'2026-01-30',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(16,2,1,NULL,'2026-02-02',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(17,3,1,NULL,'2026-02-02',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(18,2,1,NULL,'2026-02-03',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(19,3,1,NULL,'2026-02-03',8.0,3.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(20,2,1,NULL,'2026-02-04',8.0,2.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(21,3,1,NULL,'2026-02-04',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(22,2,1,NULL,'2026-02-05',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(23,3,1,NULL,'2026-02-05',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(24,2,1,NULL,'2026-02-06',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(25,3,1,NULL,'2026-02-06',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(26,2,1,NULL,'2026-02-09',8.0,2.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(27,3,1,NULL,'2026-02-09',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(28,2,1,NULL,'2026-02-10',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(29,3,1,NULL,'2026-02-10',8.0,3.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(30,2,1,NULL,'2026-02-11',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(31,3,1,NULL,'2026-02-11',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(32,2,1,NULL,'2026-02-12',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(33,3,1,NULL,'2026-02-12',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(34,2,1,NULL,'2026-02-13',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(35,3,1,NULL,'2026-02-13',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(36,2,1,NULL,'2026-02-16',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(37,3,1,NULL,'2026-02-16',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:05','2026-02-24 03:58:05');
INSERT INTO timesheets VALUES(38,2,1,NULL,'2026-02-17',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO timesheets VALUES(39,3,1,NULL,'2026-02-17',8.0,3.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO timesheets VALUES(40,2,1,NULL,'2026-02-18',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO timesheets VALUES(41,3,1,NULL,'2026-02-18',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO timesheets VALUES(42,2,1,NULL,'2026-02-19',8.0,2.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO timesheets VALUES(43,3,1,NULL,'2026-02-19',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO timesheets VALUES(44,2,1,NULL,'2026-02-20',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO timesheets VALUES(45,3,1,NULL,'2026-02-20',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO timesheets VALUES(46,2,1,NULL,'2026-02-23',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO timesheets VALUES(47,3,1,NULL,'2026-02-23',8.0,0.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO timesheets VALUES(48,2,1,NULL,'2026-02-24',8.0,2.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO timesheets VALUES(49,3,1,NULL,'2026-02-24',8.0,3.0,'Cong viec hang ngay','approved',NULL,NULL,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO timesheets VALUES(1546,2,1,NULL,'2025-01-15',8.0,0.0,'Test member tự tạo','approved',1,'2026-02-24 04:29:21','2026-02-24 04:29:21','2026-02-24 04:29:21');
INSERT INTO timesheets VALUES(1899,4,1,NULL,'2026-02-23',8.0,0.0,NULL,'approved',1,'2026-02-24 04:37:50','2026-02-24 04:36:17','2026-02-24 04:37:50');
INSERT INTO timesheets VALUES(2868,4,3,NULL,'2026-02-24',8.0,4.0,NULL,'approved',4,'2026-02-24 12:38:11','2026-02-24 12:38:04','2026-02-24 12:38:11');
INSERT INTO timesheets VALUES(2869,4,2,NULL,'2026-02-24',8.0,0.0,NULL,'approved',4,'2026-02-24 12:45:01','2026-02-24 12:38:39','2026-02-24 12:45:01');
INSERT INTO timesheets VALUES(4763,2,2,NULL,'2026-01-26',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4764,3,2,NULL,'2026-01-26',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4765,2,2,NULL,'2026-01-27',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4766,3,2,NULL,'2026-01-27',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4767,2,2,NULL,'2026-01-28',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4768,3,2,NULL,'2026-01-28',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4769,2,2,NULL,'2026-01-29',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4770,3,2,NULL,'2026-01-29',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4771,2,2,NULL,'2026-01-30',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4772,3,2,NULL,'2026-01-30',4.0,2.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4773,2,2,NULL,'2026-02-02',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4774,3,2,NULL,'2026-02-02',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4775,2,2,NULL,'2026-02-03',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4776,3,2,NULL,'2026-02-03',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4777,2,2,NULL,'2026-02-04',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4778,3,2,NULL,'2026-02-04',4.0,2.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4779,2,2,NULL,'2026-02-05',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4780,3,2,NULL,'2026-02-05',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4781,2,2,NULL,'2026-02-06',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4782,3,2,NULL,'2026-02-06',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4783,2,2,NULL,'2026-02-09',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4784,3,2,NULL,'2026-02-09',4.0,2.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4785,2,2,NULL,'2026-02-10',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4786,3,2,NULL,'2026-02-10',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4787,2,2,NULL,'2026-02-11',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4788,3,2,NULL,'2026-02-11',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4789,2,2,NULL,'2026-02-12',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4790,3,2,NULL,'2026-02-12',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4791,2,2,NULL,'2026-02-13',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4792,3,2,NULL,'2026-02-13',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4793,2,2,NULL,'2026-02-16',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4794,3,2,NULL,'2026-02-16',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4795,2,2,NULL,'2026-02-17',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4796,3,2,NULL,'2026-02-17',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4797,2,2,NULL,'2026-02-18',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4798,3,2,NULL,'2026-02-18',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4799,2,2,NULL,'2026-02-19',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:41:47');
INSERT INTO timesheets VALUES(4800,3,2,NULL,'2026-02-19',4.0,2.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4801,2,2,NULL,'2026-02-20',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4802,3,2,NULL,'2026-02-20',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4803,2,2,NULL,'2026-02-23',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4804,3,2,NULL,'2026-02-23',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4805,2,2,NULL,'2026-02-24',4.0,0.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
INSERT INTO timesheets VALUES(4806,3,2,NULL,'2026-02-24',4.0,2.0,'Cong viec du an cau','approved',NULL,NULL,'2026-02-24 15:32:12','2026-02-24 15:32:12');
CREATE TABLE project_costs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  cost_type TEXT NOT NULL, 
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'VND',
  cost_date DATE,
  invoice_number TEXT,
  vendor TEXT,
  approved_by INTEGER,
  notes TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
INSERT INTO project_costs VALUES(1,1,'salary','Chi phi salary thang 1/2024',54433120.0,'VND','2024-01-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(2,1,'equipment','Chi phi equipment thang 1/2024',39583453.0,'VND','2024-01-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(3,1,'material','Chi phi material thang 1/2024',54576099.0,'VND','2024-01-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(4,1,'travel','Chi phi travel thang 1/2024',9342694.0,'VND','2024-01-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(5,1,'salary','Chi phi salary thang 2/2024',13777926.0,'VND','2024-02-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(6,1,'equipment','Chi phi equipment thang 2/2024',27575951.0,'VND','2024-02-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(7,1,'material','Chi phi material thang 2/2024',54409725.0,'VND','2024-02-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(8,1,'travel','Chi phi travel thang 2/2024',42946581.0,'VND','2024-02-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(9,1,'salary','Chi phi salary thang 3/2024',41277044.0,'VND','2024-03-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(10,1,'equipment','Chi phi equipment thang 3/2024',24406018.0,'VND','2024-03-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(11,1,'material','Chi phi material thang 3/2024',41340809.0,'VND','2024-03-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(12,1,'travel','Chi phi travel thang 3/2024',47694803.0,'VND','2024-03-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(13,1,'salary','Chi phi salary thang 4/2024',9413079.0,'VND','2024-04-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(14,1,'equipment','Chi phi equipment thang 4/2024',24106824.0,'VND','2024-04-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(15,1,'material','Chi phi material thang 4/2024',24589463.0,'VND','2024-04-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(16,1,'travel','Chi phi travel thang 4/2024',43215960.0,'VND','2024-04-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(17,1,'salary','Chi phi salary thang 5/2024',37030387.0,'VND','2024-05-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(18,1,'equipment','Chi phi equipment thang 5/2024',44069216.0,'VND','2024-05-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(19,1,'material','Chi phi material thang 5/2024',13253198.0,'VND','2024-05-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(20,1,'travel','Chi phi travel thang 5/2024',26027374.0,'VND','2024-05-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(21,1,'salary','Chi phi salary thang 6/2024',6176013.0,'VND','2024-06-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(22,1,'equipment','Chi phi equipment thang 6/2024',36950861.0,'VND','2024-06-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(23,1,'material','Chi phi material thang 6/2024',21806252.0,'VND','2024-06-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(24,1,'travel','Chi phi travel thang 6/2024',34342393.0,'VND','2024-06-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(25,1,'salary','Chi phi salary thang 7/2024',36618063.0,'VND','2024-07-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(26,1,'equipment','Chi phi equipment thang 7/2024',17726083.0,'VND','2024-07-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(27,1,'material','Chi phi material thang 7/2024',51807403.0,'VND','2024-07-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(28,1,'travel','Chi phi travel thang 7/2024',17388673.0,'VND','2024-07-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(29,1,'salary','Chi phi salary thang 8/2024',34828090.0,'VND','2024-08-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(30,1,'equipment','Chi phi equipment thang 8/2024',54764326.0,'VND','2024-08-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(31,1,'material','Chi phi material thang 8/2024',29680398.0,'VND','2024-08-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(32,1,'travel','Chi phi travel thang 8/2024',30236278.0,'VND','2024-08-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(33,1,'salary','Chi phi salary thang 9/2024',25026341.0,'VND','2024-09-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(34,1,'equipment','Chi phi equipment thang 9/2024',23289974.0,'VND','2024-09-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(35,1,'material','Chi phi material thang 9/2024',31732435.0,'VND','2024-09-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(36,1,'travel','Chi phi travel thang 9/2024',37120147.0,'VND','2024-09-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(37,1,'salary','Chi phi salary thang 10/2024',15796989.0,'VND','2024-10-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(38,1,'equipment','Chi phi equipment thang 10/2024',28565316.0,'VND','2024-10-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(39,1,'material','Chi phi material thang 10/2024',26217703.0,'VND','2024-10-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(40,1,'travel','Chi phi travel thang 10/2024',42607666.0,'VND','2024-10-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(41,1,'salary','Chi phi salary thang 11/2024',25503773.0,'VND','2024-11-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(42,1,'equipment','Chi phi equipment thang 11/2024',26383370.0,'VND','2024-11-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(43,1,'material','Chi phi material thang 11/2024',42536789.0,'VND','2024-11-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(44,1,'travel','Chi phi travel thang 11/2024',17496781.0,'VND','2024-11-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(45,1,'salary','Chi phi salary thang 12/2024',53138860.0,'VND','2024-12-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(46,1,'equipment','Chi phi equipment thang 12/2024',13921567.0,'VND','2024-12-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(47,1,'material','Chi phi material thang 12/2024',21611445.0,'VND','2024-12-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(48,1,'travel','Chi phi travel thang 12/2024',28302938.0,'VND','2024-12-15',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_costs VALUES(2931,1,'equipment','Chi phí equipment tháng 1/2026',26794149.0,'VND','2026-01-15',NULL,NULL,NULL,NULL,1,'2026-02-24 14:13:58','2026-02-24 14:13:58');
INSERT INTO project_costs VALUES(2932,1,'material','Chi phí material tháng 1/2026',33745863.0,'VND','2026-01-15',NULL,NULL,NULL,NULL,1,'2026-02-24 14:13:58','2026-02-24 14:13:58');
INSERT INTO project_costs VALUES(2933,1,'transport','Chi phí transport tháng 1/2026',48275443.0,'VND','2026-01-15',NULL,NULL,NULL,NULL,1,'2026-02-24 14:13:58','2026-02-24 14:13:58');
INSERT INTO project_costs VALUES(2935,1,'equipment','Chi phí equipment tháng 2/2026',18373886.0,'VND','2026-02-15',NULL,NULL,NULL,NULL,1,'2026-02-24 14:13:58','2026-02-24 14:13:58');
INSERT INTO project_costs VALUES(2936,1,'material','Chi phí material tháng 2/2026',49826597.0,'VND','2026-02-15',NULL,NULL,NULL,NULL,1,'2026-02-24 14:13:58','2026-02-24 14:13:58');
INSERT INTO project_costs VALUES(2937,1,'transport','Chi phí transport tháng 2/2026',21256652.0,'VND','2026-02-15',NULL,NULL,NULL,NULL,1,'2026-02-24 14:13:58','2026-02-24 14:13:58');
INSERT INTO project_costs VALUES(2938,1,'equipment','Chi phí equipment tháng 3/2026',52000000.0,'VND','2026-03-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2939,1,'material','Chi phí material tháng 3/2026',85000000.0,'VND','2026-03-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2940,1,'transport','Chi phí transport tháng 3/2026',22000000.0,'VND','2026-03-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2941,1,'equipment','Chi phí equipment tháng 4/2026',41000000.0,'VND','2026-04-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2942,1,'material','Chi phí material tháng 4/2026',78000000.0,'VND','2026-04-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2943,1,'transport','Chi phí transport tháng 4/2026',19000000.0,'VND','2026-04-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2944,1,'equipment','Chi phí equipment tháng 5/2026',48000000.0,'VND','2026-05-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2945,1,'material','Chi phí material tháng 5/2026',92000000.0,'VND','2026-05-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2946,1,'transport','Chi phí transport tháng 5/2026',25000000.0,'VND','2026-05-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2947,1,'equipment','Chi phí equipment tháng 6/2026',55000000.0,'VND','2026-06-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2948,1,'material','Chi phí material tháng 6/2026',88000000.0,'VND','2026-06-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2949,1,'transport','Chi phí transport tháng 6/2026',21000000.0,'VND','2026-06-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2950,2,'equipment','Chi phí equipment tháng 3/2026 - PRJ002',120000000.0,'VND','2026-03-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2951,2,'material','Chi phí material tháng 3/2026 - PRJ002',95000000.0,'VND','2026-03-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2952,2,'transport','Chi phí transport tháng 3/2026 - PRJ002',32000000.0,'VND','2026-03-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2953,2,'equipment','Chi phí equipment tháng 4/2026 - PRJ002',135000000.0,'VND','2026-04-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2954,2,'material','Chi phí material tháng 4/2026 - PRJ002',108000000.0,'VND','2026-04-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2955,2,'transport','Chi phí transport tháng 4/2026 - PRJ002',38000000.0,'VND','2026-04-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2956,2,'equipment','Chi phí equipment tháng 5/2026 - PRJ002',148000000.0,'VND','2026-05-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2957,2,'material','Chi phí material tháng 5/2026 - PRJ002',125000000.0,'VND','2026-05-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2958,2,'transport','Chi phí transport tháng 5/2026 - PRJ002',44000000.0,'VND','2026-05-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2959,2,'equipment','Chi phí equipment tháng 6/2026 - PRJ002',162000000.0,'VND','2026-06-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2960,2,'material','Chi phí material tháng 6/2026 - PRJ002',138000000.0,'VND','2026-06-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2961,2,'transport','Chi phí transport tháng 6/2026 - PRJ002',51000000.0,'VND','2026-06-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2962,3,'equipment','Chi phí equipment tháng 6/2026 - PRJ003',85000000.0,'VND','2026-06-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2963,3,'material','Chi phí material tháng 6/2026 - PRJ003',62000000.0,'VND','2026-06-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_costs VALUES(2964,3,'transport','Chi phí transport tháng 6/2026 - PRJ003',28000000.0,'VND','2026-06-15',NULL,NULL,NULL,NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
CREATE TABLE project_revenues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL,
  description TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT DEFAULT 'VND',
  revenue_date DATE,
  invoice_number TEXT,
  payment_status TEXT DEFAULT 'pending', 
  notes TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
INSERT INTO project_revenues VALUES(1,1,'Dot thanh toan Q1/2024',589862372.0,'VND','2024-03-20',NULL,'paid',NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_revenues VALUES(2,1,'Dot thanh toan Q2/2024',124697494.0,'VND','2024-06-20',NULL,'paid',NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_revenues VALUES(3,1,'Dot thanh toan Q3/2024',383917398.0,'VND','2024-09-20',NULL,'paid',NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_revenues VALUES(4,1,'Dot thanh toan Q4/2024',581436776.0,'VND','2024-12-20',NULL,'paid',NULL,1,'2026-02-24 03:58:06','2026-02-24 03:58:06');
INSERT INTO project_revenues VALUES(258,1,'Đợt thanh toán tháng 2/2026',589104124.0,'VND','2026-02-20',NULL,'paid',NULL,1,'2026-02-24 14:13:58','2026-02-24 14:13:58');
INSERT INTO project_revenues VALUES(259,1,'Đợt thanh toán tháng 4/2026',800000000.0,'VND','2026-04-20',NULL,'paid',NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_revenues VALUES(260,1,'Đợt thanh toán tháng 6/2026',1200000000.0,'VND','2026-06-20',NULL,'paid',NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_revenues VALUES(261,2,'Đợt thanh toán tháng 4/2026 - PRJ002',1500000000.0,'VND','2026-04-25',NULL,'paid',NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_revenues VALUES(262,2,'Đợt thanh toán tháng 6/2026 - PRJ002',2000000000.0,'VND','2026-06-25',NULL,'paid',NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_revenues VALUES(263,3,'Tạm ứng khởi động dự án Eco City',1200000000.0,'VND','2026-06-30',NULL,'pending',NULL,1,'2026-02-24 15:13:27','2026-02-24 15:13:27');
CREATE TABLE assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL, 
  brand TEXT,
  model TEXT,
  serial_number TEXT,
  specifications TEXT,
  purchase_date DATE,
  purchase_price REAL DEFAULT 0,
  current_value REAL DEFAULT 0,
  warranty_expiry DATE,
  status TEXT DEFAULT 'active', 
  location TEXT,
  department TEXT,
  assigned_to INTEGER,
  assigned_date DATE,
  notes TEXT,
  image_url TEXT,
  created_by INTEGER,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  FOREIGN KEY (created_by) REFERENCES users(id)
);
INSERT INTO assets VALUES(1,'PC-001','Máy tính làm việc BIM #1','computer','Dell','Precision 5820','SN123456','CPU: Intel Xeon W-2223, RAM: 64GB ECC, GPU: NVIDIA RTX 3080 10GB, SSD: 2TB NVMe','2023-01-15',45000000.0,38000000.0,NULL,'active',NULL,'Kiến trúc',2,NULL,NULL,NULL,1,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO assets VALUES(2,'LP-001','Laptop BIM Workstation #1','laptop','HP','ZBook Studio G9','SN789012','CPU: Intel Core i9-12900H, RAM: 64GB DDR5, GPU: NVIDIA RTX A2000, SSD: 2TB NVMe','2023-03-20',52000000.0,45000000.0,NULL,'unused',NULL,'Kết cấu',3,NULL,NULL,NULL,1,'2026-02-24 03:34:42','2026-02-24 09:11:36');
INSERT INTO assets VALUES(3,'SW-001','License Autodesk AEC Collection','software','Autodesk','AEC Collection 2024','AEC-2024-001','Revit, Civil 3D, Navisworks, AutoCAD - 5 users','2024-01-01',28000000.0,28000000.0,NULL,'unused',NULL,'Toàn công ty',NULL,NULL,NULL,NULL,1,'2026-02-24 03:34:42','2026-02-24 09:12:08');
INSERT INTO assets VALUES(4,'VH-001','Xe máy công tác','vehicle','Honda','SH 150i','51B1-12345','Màu đen, BKS: 51B1-12345','2022-06-01',75000000.0,55000000.0,NULL,'active',NULL,'Quản lý dự án',4,NULL,NULL,NULL,1,'2026-02-24 03:34:42','2026-02-24 03:34:42');
INSERT INTO assets VALUES(8,'PC-002','Máy in A0 đa chức năng','equipment','HP','DesignJet T830','','','',35000000.0,29750000.0,NULL,'unused',NULL,'Văn phòng',NULL,NULL,NULL,NULL,1,'2026-02-24 03:58:06','2026-02-24 09:12:01');
CREATE TABLE asset_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  action TEXT NOT NULL, 
  from_user INTEGER,
  to_user INTEGER,
  notes TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (asset_id) REFERENCES assets(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (from_user) REFERENCES users(id),
  FOREIGN KEY (to_user) REFERENCES users(id)
);
CREATE TABLE notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  type TEXT DEFAULT 'info', 
  related_type TEXT, 
  related_id INTEGER,
  is_read INTEGER DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE TABLE cost_types (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT UNIQUE NOT NULL, name TEXT NOT NULL, description TEXT, color TEXT DEFAULT '#6B7280', is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0);
INSERT INTO cost_types VALUES(361,'salary','Lương nhân sự','Chi phí lương và phúc lợi nhân sự','#00A651',1,1);
INSERT INTO cost_types VALUES(362,'material','Chi phí vật liệu','Vật tư, nguyên liệu thi công','#0066CC',1,2);
INSERT INTO cost_types VALUES(363,'equipment','Chi phí thiết bị','Thuê hoặc khấu hao thiết bị','#8B5CF6',1,3);
INSERT INTO cost_types VALUES(364,'transport','Chi phí vận chuyển','Di chuyển, vận chuyển hàng hóa','#FF6B00',1,4);
INSERT INTO cost_types VALUES(365,'other','Chi phí khác','Các chi phí phát sinh khác','#6B7280',1,5);
CREATE TABLE monthly_labor_costs (id INTEGER PRIMARY KEY AUTOINCREMENT, month INTEGER NOT NULL, year INTEGER NOT NULL, total_labor_cost REAL NOT NULL, notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(month, year));
INSERT INTO monthly_labor_costs VALUES(1,2,2026,400000000.0,'Updated','2026-02-24 10:07:00','2026-02-24 10:42:23');
INSERT INTO monthly_labor_costs VALUES(2,1,2026,300000000.0,'Updated','2026-02-24 12:30:55','2026-02-24 12:30:55');
CREATE TABLE project_labor_costs (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, month INTEGER NOT NULL, year INTEGER NOT NULL, total_labor_cost REAL NOT NULL DEFAULT 0, total_hours REAL NOT NULL DEFAULT 0, cost_per_hour REAL NOT NULL DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE(project_id, month, year), FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE);
INSERT INTO project_labor_costs VALUES(1,1,2,2026,371517028.0,300.0,1238390.0,'2026-02-24 13:22:07','2026-02-24 13:59:06');
INSERT INTO project_labor_costs VALUES(2,2,2,2026,13622291.0,11.0,1238390.0,'2026-02-24 13:22:07','2026-02-24 13:32:09');
INSERT INTO project_labor_costs VALUES(3,3,2,2026,14860681.0,12.0,1238390.0,'2026-02-24 13:22:07','2026-02-24 13:32:09');
INSERT INTO project_labor_costs VALUES(4,1,1,2026,300000000.0,85.0,3529412.0,'2026-02-24 13:33:29','2026-02-24 13:33:29');
INSERT INTO project_labor_costs VALUES(5,1,3,2026,285000000.0,260.0,1096154.0,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_labor_costs VALUES(6,1,4,2026,320000000.0,290.0,1103448.0,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_labor_costs VALUES(7,1,5,2026,355000000.0,320.0,1109375.0,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_labor_costs VALUES(8,1,6,2026,410000000.0,380.0,1078947.0,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_labor_costs VALUES(9,2,3,2026,450000000.0,380.0,1184211.0,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_labor_costs VALUES(10,2,4,2026,520000000.0,440.0,1181818.0,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_labor_costs VALUES(11,2,5,2026,498000000.0,420.0,1185714.0,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_labor_costs VALUES(12,2,6,2026,575000000.0,490.0,1173469.0,'2026-02-24 15:13:27','2026-02-24 15:13:27');
INSERT INTO project_labor_costs VALUES(13,3,6,2026,320000000.0,280.0,1142857.0,'2026-02-24 15:13:27','2026-02-24 15:13:27');
ANALYZE sqlite_schema;
INSERT INTO sqlite_stat1 VALUES('monthly_labor_costs','sqlite_autoindex_monthly_labor_costs_1','2 1 1');
INSERT INTO sqlite_stat1 VALUES('cost_types','sqlite_autoindex_cost_types_1','5 1');
INSERT INTO sqlite_stat1 VALUES('assets','sqlite_autoindex_assets_1','5 1');
INSERT INTO sqlite_stat1 VALUES('timesheets','idx_timesheets_work_date','97 4');
INSERT INTO sqlite_stat1 VALUES('timesheets','idx_timesheets_project_id','97 33');
INSERT INTO sqlite_stat1 VALUES('timesheets','idx_timesheets_user_id','97 33');
INSERT INTO sqlite_stat1 VALUES('tasks','idx_tasks_status','15 4');
INSERT INTO sqlite_stat1 VALUES('tasks','idx_tasks_due_date','15 2');
INSERT INTO sqlite_stat1 VALUES('tasks','idx_tasks_assigned_to','15 4');
INSERT INTO sqlite_stat1 VALUES('tasks','idx_tasks_project_id','15 5');
INSERT INTO sqlite_stat1 VALUES('d1_migrations','sqlite_autoindex_d1_migrations_1','2 1');
INSERT INTO sqlite_stat1 VALUES('task_history',NULL,'29');
INSERT INTO sqlite_stat1 VALUES('_cf_METADATA',NULL,'1');
INSERT INTO sqlite_stat1 VALUES('project_costs',NULL,'81');
INSERT INTO sqlite_stat1 VALUES('users','sqlite_autoindex_users_2','5 1');
INSERT INTO sqlite_stat1 VALUES('users','sqlite_autoindex_users_1','5 1');
INSERT INTO sqlite_stat1 VALUES('project_labor_costs','sqlite_autoindex_project_labor_costs_1','13 5 1 1');
INSERT INTO sqlite_stat1 VALUES('project_members','idx_project_members_user_id','12 3');
INSERT INTO sqlite_stat1 VALUES('project_members','idx_project_members_project_id','12 4');
INSERT INTO sqlite_stat1 VALUES('project_members','sqlite_autoindex_project_members_1','12 4 1');
INSERT INTO sqlite_stat1 VALUES('project_revenues',NULL,'10');
INSERT INTO sqlite_stat1 VALUES('disciplines','sqlite_autoindex_disciplines_1','24 1');
INSERT INTO sqlite_stat1 VALUES('projects','sqlite_autoindex_projects_1','3 1');
INSERT INTO sqlite_stat1 VALUES('categories',NULL,'5');
DELETE FROM sqlite_sequence;
INSERT INTO sqlite_sequence VALUES('d1_migrations',2);
INSERT INTO sqlite_sequence VALUES('disciplines',3120);
INSERT INTO sqlite_sequence VALUES('users',646);
INSERT INTO sqlite_sequence VALUES('projects',389);
INSERT INTO sqlite_sequence VALUES('categories',6);
INSERT INTO sqlite_sequence VALUES('tasks',321);
INSERT INTO sqlite_sequence VALUES('timesheets',4807);
INSERT INTO sqlite_sequence VALUES('assets',516);
INSERT INTO sqlite_sequence VALUES('notifications',17);
INSERT INTO sqlite_sequence VALUES('project_costs',2964);
INSERT INTO sqlite_sequence VALUES('project_revenues',263);
INSERT INTO sqlite_sequence VALUES('task_history',50);
INSERT INTO sqlite_sequence VALUES('project_members',260);
INSERT INTO sqlite_sequence VALUES('cost_types',375);
INSERT INTO sqlite_sequence VALUES('monthly_labor_costs',2);
INSERT INTO sqlite_sequence VALUES('project_labor_costs',13);
CREATE INDEX idx_tasks_project_id ON tasks(project_id);
CREATE INDEX idx_tasks_assigned_to ON tasks(assigned_to);
CREATE INDEX idx_tasks_due_date ON tasks(due_date);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_timesheets_user_id ON timesheets(user_id);
CREATE INDEX idx_timesheets_project_id ON timesheets(project_id);
CREATE INDEX idx_timesheets_work_date ON timesheets(work_date);
CREATE INDEX idx_project_members_project_id ON project_members(project_id);
CREATE INDEX idx_project_members_user_id ON project_members(user_id);
CREATE INDEX idx_notifications_user_id ON notifications(user_id);
COMMIT;

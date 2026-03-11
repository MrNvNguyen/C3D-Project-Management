-- Normalize project_members.role values
-- Old values: 'admin', 'leader'  → New values: 'project_admin', 'project_leader'
-- 'member' remains unchanged

UPDATE project_members SET role = 'project_admin'  WHERE role = 'admin';
UPDATE project_members SET role = 'project_leader' WHERE role = 'leader';

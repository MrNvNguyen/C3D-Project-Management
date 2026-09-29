-- VAT hợp đồng khai trên dự án. GTHĐ = tổng giá trị gói thầu ÷ (1 + vat_pct/100).
-- vat_pct = 0 → GTHĐ bằng tổng gói (gross chưa tách VAT).
ALTER TABLE projects ADD COLUMN vat_pct REAL DEFAULT 0;

UPDATE projects
SET contract_value = (
  SELECT COALESCE(SUM(contract_value), 0)
  FROM legal_packages
  WHERE legal_packages.project_id = projects.id
)
WHERE id IN (SELECT DISTINCT project_id FROM legal_packages);

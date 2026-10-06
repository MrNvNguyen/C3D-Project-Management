-- Doanh thu đồng bộ từ phiếu thanh toán: ngày năm tài chính = ngày nghiệm thu khi đã nhập.
UPDATE project_revenues
SET revenue_date = (
  SELECT substr(pr.request_date, 1, 10)
  FROM payment_requests pr
  WHERE pr.revenue_id = project_revenues.id
    AND pr.request_date IS NOT NULL
    AND length(trim(pr.request_date)) >= 10
)
WHERE EXISTS (
  SELECT 1 FROM payment_requests pr
  WHERE pr.revenue_id = project_revenues.id
    AND pr.request_date IS NOT NULL
    AND length(trim(pr.request_date)) >= 10
    AND substr(pr.request_date, 1, 10) != COALESCE(substr(project_revenues.revenue_date, 1, 10), '')
);

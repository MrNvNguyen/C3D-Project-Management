-- Trạng thái gói thầu đã ký hợp đồng hay chưa.
-- Gói đã có ngày ký được coi là đã ký, để danh sách hiện tại không chuyển thành chưa ký.

ALTER TABLE legal_packages ADD COLUMN contract_signed INTEGER NOT NULL DEFAULT 0;

UPDATE legal_packages
SET contract_signed = 1
WHERE start_date IS NOT NULL AND length(trim(start_date)) > 0;

-- Migration 0007: Add project_code_letter column to projects table
-- This field stores the project's document code used for outgoing letter numbering
-- e.g., "BBT-MMC-BHH1" → letters will be numbered as "OC/BBT-MMC-BHH1/001/2025"

ALTER TABLE projects ADD COLUMN project_code_letter TEXT DEFAULT '';

-- Update existing projects: use project code as default document code
UPDATE projects SET project_code_letter = code WHERE project_code_letter = '' OR project_code_letter IS NULL;

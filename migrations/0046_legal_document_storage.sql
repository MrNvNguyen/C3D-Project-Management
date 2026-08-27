-- Object-storage metadata for legal document binaries (base64 stays in
-- file_url only as a legacy fallback until rows are migrated to R2).

ALTER TABLE legal_documents ADD COLUMN r2_key TEXT;
ALTER TABLE legal_documents ADD COLUMN content_type TEXT;
ALTER TABLE legal_documents ADD COLUMN byte_length INTEGER;
CREATE INDEX IF NOT EXISTS idx_legal_docs_r2 ON legal_documents(r2_key);

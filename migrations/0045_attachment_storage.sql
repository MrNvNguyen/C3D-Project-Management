-- Metadata for object storage. Existing `data` TEXT remains for legacy rows.
ALTER TABLE message_attachments ADD COLUMN r2_key TEXT;
ALTER TABLE message_attachments ADD COLUMN content_type TEXT;
CREATE INDEX IF NOT EXISTS idx_msg_att_r2 ON message_attachments(r2_key);

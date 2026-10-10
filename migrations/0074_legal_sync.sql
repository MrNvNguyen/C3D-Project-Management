-- Cross-deployment legal dossier sync: id map + remembered source pair on project.

CREATE TABLE IF NOT EXISTS legal_sync_id_map (
  local_project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  entity           TEXT NOT NULL,
  source_id        INTEGER NOT NULL,
  local_id         INTEGER NOT NULL,
  PRIMARY KEY (local_project_id, entity, source_id)
);

CREATE INDEX IF NOT EXISTS idx_legal_sync_map_local_entity
  ON legal_sync_id_map(local_project_id, entity, local_id);

ALTER TABLE projects ADD COLUMN legal_sync_peer_origin TEXT;
ALTER TABLE projects ADD COLUMN legal_sync_source_project_id INTEGER;

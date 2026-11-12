-- Aufgabentyp: Prüfauftrag (Element), Mängelbehebung (Mangel), Sonstiges
ALTER TABLE tasks ADD COLUMN kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('inspection','defect','other'));
UPDATE tasks SET kind = 'defect' WHERE defect_id IS NOT NULL;

-- Beobachter einer Aufgabe (bekommen Benachrichtigungen bei Statuswechsel und Kommentaren)
CREATE TABLE task_watchers (
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, user_id)
);
CREATE INDEX idx_task_watchers_user ON task_watchers(tenant_id, user_id);
INSERT OR IGNORE INTO task_watchers (task_id, user_id, tenant_id, created_at) SELECT id, created_by, tenant_id, created_at FROM tasks WHERE created_by IS NOT NULL;
INSERT OR IGNORE INTO task_watchers (task_id, user_id, tenant_id, created_at) SELECT id, assignee_id, tenant_id, created_at FROM tasks WHERE assignee_id IS NOT NULL;

-- @-Erwähnungen in Kommentaren (JSON-Liste von Nutzer-IDs)
ALTER TABLE task_comments ADD COLUMN mentions TEXT NOT NULL DEFAULT '[]';

-- Behebung dokumentieren: Notiz und Nachher-Foto (wer/wann steht in resolved_by/resolved_at)
ALTER TABLE defects ADD COLUMN resolution_note TEXT NOT NULL DEFAULT '';
ALTER TABLE defects ADD COLUMN resolution_photo_key TEXT;

-- Ausblenden (Duplikat, nicht relevant …): zählt nicht mehr mit, bleibt über einen Filter sichtbar
ALTER TABLE defects ADD COLUMN hidden_at INTEGER;
ALTER TABLE defects ADD COLUMN hidden_by TEXT;
ALTER TABLE defects ADD COLUMN hidden_reason TEXT NOT NULL DEFAULT '';
CREATE INDEX idx_tasks_defect ON tasks(defect_id);

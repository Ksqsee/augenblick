-- Autopilot: Regeln je Workspace (Stufe aus/vorschlagen/automatisch + Einstellungen) und Protokoll mit Rückgängig.
CREATE TABLE automation_settings (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('off','suggest','auto')),
  -- JSON, z. B. Zuweisungsregeln für assign_defect_tasks
  config TEXT NOT NULL DEFAULT '{}',
  updated_at INTEGER NOT NULL,
  updated_by TEXT,
  PRIMARY KEY (tenant_id, key)
);

CREATE TABLE automation_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  at INTEGER NOT NULL,
  summary TEXT NOT NULL,
  -- worauf sich der Eintrag bezieht (task, inspection, defect, report_month …)
  entity_type TEXT,
  entity_id TEXT,
  -- Ort für den Zugriffsbereich eingeschränkter Mitglieder (beide leer = nur ohne Einschränkung sichtbar)
  building_id TEXT,
  property_id TEXT,
  -- Person, der die Regel etwas zugewiesen hat (darf sehen und rückgängig machen)
  assignee_id TEXT,
  link TEXT,
  -- JSON mit dem, was „Rückgängig“ tut; NULL = nicht rückgängig zu machen
  undo TEXT,
  undone_at INTEGER,
  undone_by TEXT,
  -- 'system' (Zeitplan/Regel) oder die auslösende Person
  actor TEXT NOT NULL DEFAULT 'system'
);
CREATE INDEX idx_automation_log_tenant ON automation_log(tenant_id, at);
CREATE INDEX idx_automation_log_entity ON automation_log(tenant_id, key, entity_id);

-- Wiederkehrende Aufgaben: Rhythmus und Verweis auf die Vorgängerin
ALTER TABLE tasks ADD COLUMN recurrence TEXT CHECK (recurrence IN ('monthly','quarterly','yearly'));
ALTER TABLE tasks ADD COLUMN recurs_from TEXT;
CREATE INDEX idx_tasks_recurs_from ON tasks(recurs_from);
-- Prüfauftrag für ein ganzes Gebäude (Rundgang, plan_week)
ALTER TABLE tasks ADD COLUMN building_id TEXT REFERENCES buildings(id);
CREATE INDEX idx_tasks_building ON tasks(building_id);

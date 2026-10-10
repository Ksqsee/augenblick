-- Begehungen, Grundrisse, Subunternehmer, Etiketten, Offline-Sync
PRAGMA defer_foreign_keys = true;

-- Mängel können jetzt auch aus Begehungen stammen (ohne Element).
-- Verweise aus tasks vorübergehend lösen, damit die Tabelle neu aufgebaut werden kann.
CREATE TABLE _task_defect_map AS SELECT id, defect_id FROM tasks WHERE defect_id IS NOT NULL;
UPDATE tasks SET defect_id = NULL WHERE defect_id IS NOT NULL;

CREATE TABLE defects_new (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  asset_id TEXT REFERENCES assets(id),
  inspection_id TEXT REFERENCES inspections(id),
  walkthrough_id TEXT,
  checkpoint_id TEXT,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  legal_basis TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL CHECK (status IN ('open','resolved')),
  photo_key TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT
);
INSERT INTO defects_new (id, tenant_id, property_id, asset_id, inspection_id, checkpoint_id, title, note, severity, status, photo_key, created_at, resolved_at, resolved_by)
  SELECT d.id, d.tenant_id, b.property_id, d.asset_id, d.inspection_id, d.checkpoint_id, d.title, d.note, d.severity, d.status, d.photo_key, d.created_at, d.resolved_at, d.resolved_by
    FROM defects d JOIN assets a ON a.id = d.asset_id JOIN buildings b ON b.id = a.building_id;
DROP TABLE defects;
ALTER TABLE defects_new RENAME TO defects;
CREATE INDEX idx_defects_tenant ON defects(tenant_id, status);
CREATE INDEX idx_defects_property ON defects(property_id, status);
CREATE INDEX idx_defects_asset ON defects(asset_id);

UPDATE tasks SET defect_id = (SELECT m.defect_id FROM _task_defect_map m WHERE m.id = tasks.id)
 WHERE id IN (SELECT id FROM _task_defect_map);
DROP TABLE _task_defect_map;

CREATE TABLE walkthroughs (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  building_id TEXT REFERENCES buildings(id),
  building_type TEXT NOT NULL,
  inspector_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK (status IN ('draft','submitted')),
  result TEXT,
  questions TEXT NOT NULL,
  answers TEXT NOT NULL DEFAULT '{}',
  findings TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  participants TEXT NOT NULL DEFAULT '',
  signature TEXT,
  signer_name TEXT NOT NULL DEFAULT '',
  inspected_at INTEGER,
  next_due_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_walkthroughs_property ON walkthroughs(property_id, inspected_at);
CREATE INDEX idx_walkthroughs_tenant ON walkthroughs(tenant_id, status);

CREATE TABLE floor_plans (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  building_id TEXT NOT NULL REFERENCES buildings(id),
  name TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 0,
  file_key TEXT NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_floor_plans_building ON floor_plans(building_id);

ALTER TABLE assets ADD COLUMN floor_plan_id TEXT;
ALTER TABLE assets ADD COLUMN marker_x REAL;
ALTER TABLE assets ADD COLUMN marker_y REAL;
ALTER TABLE assets ADD COLUMN label_code TEXT;
CREATE UNIQUE INDEX idx_assets_label ON assets(tenant_id, label_code) WHERE label_code IS NOT NULL;

ALTER TABLE properties ADD COLUMN building_type TEXT NOT NULL DEFAULT 'general';

CREATE TABLE subcontractors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  company TEXT NOT NULL,
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  trade TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_subcontractors_tenant ON subcontractors(tenant_id);

ALTER TABLE tasks ADD COLUMN subcontractor_id TEXT REFERENCES subcontractors(id);
ALTER TABLE tasks ADD COLUMN share_token TEXT;
ALTER TABLE tasks ADD COLUMN external_note TEXT NOT NULL DEFAULT '';
ALTER TABLE tasks ADD COLUMN external_done_at INTEGER;
ALTER TABLE tasks ADD COLUMN property_id TEXT REFERENCES properties(id);
CREATE UNIQUE INDEX idx_tasks_share ON tasks(share_token) WHERE share_token IS NOT NULL;

-- Offline erfasste Prüfungen idempotent übernehmen
ALTER TABLE inspections ADD COLUMN client_id TEXT;
CREATE UNIQUE INDEX idx_inspections_client ON inspections(tenant_id, client_id) WHERE client_id IS NOT NULL;

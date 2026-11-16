-- Plan v6 Paket U: Mangel-Status „ungültig“ (Duplikat oder Fehleintrag, mit Grund) – zählt nicht in Quoten und
-- Behebungsdauer; Zeitpunkt des Wiederöffnens (ein wieder geöffneter Mangel braucht eine neue Aufgabe);
-- einmaliger Nachtrag der Katalog-Grundausstattung (Feuerlöscher, Rauchwarnmelder, Brandschutzklappen).
PRAGMA defer_foreign_keys = true;

-- Status-Prüfung (CHECK) lässt sich in SQLite nur durch Neuaufbau ändern. Verweise aus tasks vorübergehend lösen.
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
  status TEXT NOT NULL CHECK (status IN ('open','resolved','invalid')),
  photo_key TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT,
  measure TEXT NOT NULL DEFAULT '',
  resolution_note TEXT NOT NULL DEFAULT '',
  resolution_photo_key TEXT,
  hidden_at INTEGER,
  hidden_by TEXT,
  hidden_reason TEXT NOT NULL DEFAULT '',
  -- „ungültig“: wann, von wem, warum (Pflicht)
  invalid_at INTEGER,
  invalid_by TEXT,
  invalid_reason TEXT NOT NULL DEFAULT '',
  -- zuletzt wieder geöffnet (Aufgaben, die davor erledigt wurden, zählen nicht mehr)
  reopened_at INTEGER
);
INSERT INTO defects_new (id, tenant_id, property_id, asset_id, inspection_id, walkthrough_id, checkpoint_id, title, note, legal_basis, severity, status,
                         photo_key, created_at, resolved_at, resolved_by, measure, resolution_note, resolution_photo_key, hidden_at, hidden_by, hidden_reason)
  SELECT id, tenant_id, property_id, asset_id, inspection_id, walkthrough_id, checkpoint_id, title, note, legal_basis, severity, status,
         photo_key, created_at, resolved_at, resolved_by, measure, resolution_note, resolution_photo_key, hidden_at, hidden_by, hidden_reason
    FROM defects;
DROP TABLE defects;
ALTER TABLE defects_new RENAME TO defects;
CREATE INDEX idx_defects_tenant ON defects(tenant_id, status);
CREATE INDEX idx_defects_property ON defects(property_id, status);
CREATE INDEX idx_defects_asset ON defects(asset_id);

UPDATE tasks SET defect_id = (SELECT m.defect_id FROM _task_defect_map m WHERE m.id = tasks.id)
 WHERE id IN (SELECT id FROM _task_defect_map);
DROP TABLE _task_defect_map;

-- Katalog-Nachtrag genau einmal je Workspace (worker/catalog.ts)
ALTER TABLE tenants ADD COLUMN catalog_extra_at INTEGER;

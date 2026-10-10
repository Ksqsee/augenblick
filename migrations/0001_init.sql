-- Prüfkompass: Grundschema
CREATE TABLE tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE memberships (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner','admin','inspector','viewer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, user_id)
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  expires_at INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE invites (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL COLLATE NOCASE,
  role TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER
);

CREATE TABLE properties (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_properties_tenant ON properties(tenant_id);

CREATE TABLE buildings (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  name TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX idx_buildings_property ON buildings(property_id);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  building_id TEXT NOT NULL REFERENCES buildings(id),
  category TEXT NOT NULL,
  code TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  floor TEXT NOT NULL DEFAULT '',
  manufacturer TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  attributes TEXT NOT NULL DEFAULT '{}',
  last_inspection_id TEXT,
  last_inspected_at INTEGER,
  last_result TEXT,
  next_due_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER,
  UNIQUE (tenant_id, code)
);
CREATE INDEX idx_assets_building ON assets(building_id);
CREATE INDEX idx_assets_due ON assets(tenant_id, next_due_at);

CREATE TABLE template_overrides (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  category TEXT NOT NULL,
  checkpoints TEXT NOT NULL,
  interval_months INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, category)
);

CREATE TABLE inspections (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  inspector_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('draft','submitted')),
  result TEXT,
  answers TEXT NOT NULL DEFAULT '{}',
  maintenance TEXT NOT NULL DEFAULT '[]',
  checkpoints TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  signature TEXT,
  signer_name TEXT NOT NULL DEFAULT '',
  next_due_at INTEGER,
  inspected_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_inspections_asset ON inspections(asset_id, inspected_at);
CREATE INDEX idx_inspections_tenant ON inspections(tenant_id, inspected_at);

CREATE TABLE defects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  inspection_id TEXT REFERENCES inspections(id),
  checkpoint_id TEXT,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  status TEXT NOT NULL CHECK (status IN ('open','resolved')),
  photo_key TEXT,
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  resolved_by TEXT
);
CREATE INDEX idx_defects_tenant ON defects(tenant_id, status);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('open','in_progress','done','cancelled')),
  priority TEXT NOT NULL CHECK (priority IN ('low','medium','high')),
  due_at INTEGER,
  assignee_id TEXT REFERENCES users(id),
  asset_id TEXT REFERENCES assets(id),
  defect_id TEXT REFERENCES defects(id),
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_tasks_tenant ON tasks(tenant_id, status);

CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_activity_tenant ON activity(tenant_id, created_at);

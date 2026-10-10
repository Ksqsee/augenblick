-- Prüfarten, eigene Typen, Anhänge, Archiv, Firmenprofil, Aufgaben-Erweiterungen,
-- Benachrichtigungen, Konto/Datenschutz, Brandschutzbeauftragte

-- Prüfarten je Element: { "<prüfart>": { enabled, lastAt, lastResult, nextDueAt } }
ALTER TABLE assets ADD COLUMN schedules TEXT NOT NULL DEFAULT '{}';
ALTER TABLE inspections ADD COLUMN schedule TEXT NOT NULL DEFAULT 'main';
ALTER TABLE inspections ADD COLUMN archived_at INTEGER;
UPDATE assets SET schedules = json_object('main', json_object('enabled', json('true'), 'lastAt', last_inspected_at, 'lastResult', last_result, 'nextDueAt', next_due_at));
CREATE INDEX idx_inspections_schedule ON inspections(asset_id, schedule, status, inspected_at);

-- Eigene Elementtypen
CREATE TABLE custom_categories (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  plural TEXT NOT NULL,
  prefix TEXT NOT NULL,
  norm TEXT NOT NULL DEFAULT '',
  interval_months INTEGER NOT NULL,
  checkpoints TEXT NOT NULL,
  attributes TEXT NOT NULL DEFAULT '[]',
  maintenance TEXT NOT NULL DEFAULT '[]',
  color TEXT NOT NULL DEFAULT 'slate',
  base TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER,
  PRIMARY KEY (tenant_id, key)
);

-- Fotos und Dokumente
CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  asset_id TEXT REFERENCES assets(id),
  inspection_id TEXT REFERENCES inspections(id),
  walkthrough_id TEXT REFERENCES walkthroughs(id),
  file_key TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  caption TEXT NOT NULL DEFAULT '',
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_attachments_asset ON attachments(asset_id);
CREATE INDEX idx_attachments_inspection ON attachments(inspection_id);

-- Firmenprofil & Einstellungen
ALTER TABLE tenants ADD COLUMN logo_key TEXT;
ALTER TABLE tenants ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN email TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN website TEXT NOT NULL DEFAULT '';
ALTER TABLE tenants ADD COLUMN pdf_pattern TEXT NOT NULL DEFAULT '{datum}_{code}_{art}';
ALTER TABLE tenants ADD COLUMN archive_after_months INTEGER;
ALTER TABLE properties ADD COLUMN pdf_pattern TEXT;

-- Aufgaben: Labels, SLA, Kommentare
CREATE TABLE task_labels (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'slate',
  created_at INTEGER NOT NULL
);
ALTER TABLE tasks ADD COLUMN labels TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN first_response_at INTEGER;
ALTER TABLE tasks ADD COLUMN closed_at INTEGER;

CREATE TABLE sla_policies (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  priority TEXT NOT NULL CHECK (priority IN ('low','medium','high')),
  response_hours INTEGER NOT NULL,
  resolution_hours INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, priority)
);

CREATE TABLE task_comments (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  user_id TEXT,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_task_comments_task ON task_comments(task_id, created_at);

-- Benachrichtigungen
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link TEXT,
  dedupe_key TEXT,
  read_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_notifications_user ON notifications(user_id, tenant_id, created_at);
CREATE UNIQUE INDEX idx_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
ALTER TABLE memberships ADD COLUMN notify_prefs TEXT NOT NULL DEFAULT '{}';

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- Konto
ALTER TABLE sessions ADD COLUMN created_at INTEGER;
ALTER TABLE sessions ADD COLUMN last_seen_at INTEGER;
ALTER TABLE sessions ADD COLUMN user_agent TEXT NOT NULL DEFAULT '';

CREATE TABLE password_resets (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_by TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE legal_acks (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  doc TEXT NOT NULL,
  version TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  user_agent TEXT NOT NULL DEFAULT ''
);
CREATE INDEX idx_legal_acks_user ON legal_acks(user_id, doc);

-- Brandschutzbeauftragte je Objekt (mit Historie)
CREATE TABLE fire_officers (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  name TEXT NOT NULL,
  company TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  qualification TEXT NOT NULL DEFAULT '',
  appointed_from INTEGER NOT NULL,
  appointed_to INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_fire_officers_property ON fire_officers(property_id, appointed_from);

-- Zugriffsbereich je Mitglied (NULL = alles) und Recht, neue Elemente anzulegen
ALTER TABLE memberships ADD COLUMN scope TEXT;
ALTER TABLE memberships ADD COLUMN can_create INTEGER NOT NULL DEFAULT 1;

-- Brandschutzbeauftragten-Status je Mitglied (DGUV Information 205-003) mit fälschungssicherem Verlauf
ALTER TABLE memberships ADD COLUMN fire_officer INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memberships ADD COLUMN fire_officer_qualification TEXT NOT NULL DEFAULT '';
CREATE TABLE member_flag_history (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  flag TEXT NOT NULL,
  value INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  changed_by TEXT NOT NULL,
  changed_at INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  hash TEXT NOT NULL
);
CREATE INDEX idx_member_flag_history ON member_flag_history(tenant_id, user_id, changed_at);

-- Qualifikation der durchführenden Person zum Zeitpunkt der Begehung
ALTER TABLE walkthroughs ADD COLUMN inspector_fire_officer INTEGER;
ALTER TABLE walkthroughs ADD COLUMN inspector_qualification TEXT NOT NULL DEFAULT '';

-- Prüfanlass, Berichtigung und Nachprüfung
ALTER TABLE inspections ADD COLUMN purpose TEXT NOT NULL DEFAULT 'regular';
ALTER TABLE inspections ADD COLUMN kinds TEXT NOT NULL DEFAULT '[]';
ALTER TABLE inspections ADD COLUMN supersedes_id TEXT;
ALTER TABLE inspections ADD COLUMN superseded_by TEXT;
ALTER TABLE inspections ADD COLUMN superseded_at INTEGER;
ALTER TABLE inspections ADD COLUMN follow_up_of TEXT;
UPDATE inspections SET kinds = json_array(kind);

-- Anlass der Begehung und Verknüpfung zur Ausgangsbegehung
ALTER TABLE walkthroughs ADD COLUMN purpose TEXT NOT NULL DEFAULT 'regular';
ALTER TABLE walkthroughs ADD COLUMN follow_up_of TEXT;

-- Eigene Prüfungsarten und Erinnerung vor Fälligkeit (Tage, NULL = aus)
ALTER TABLE tenants ADD COLUMN inspection_kinds TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tenants ADD COLUMN reminder_days INTEGER DEFAULT 30;

-- Papierkorb: Etikett beim Löschen merken, damit es bei Wiederherstellung zurückkommt
ALTER TABLE assets ADD COLUMN deleted_label TEXT;

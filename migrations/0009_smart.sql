-- Automatisierung: für hohe/kritische Mängel beim Prüfabschluss automatisch Aufgaben anlegen (1 = an)
ALTER TABLE tenants ADD COLUMN auto_tasks INTEGER NOT NULL DEFAULT 1;

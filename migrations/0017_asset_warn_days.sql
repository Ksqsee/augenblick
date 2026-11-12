-- Vorwarnzeit je Element (Tage vor Fälligkeit); NULL = Vorgabe des Workspaces
ALTER TABLE assets ADD COLUMN warn_days INTEGER;

-- Maßnahme je Mangel
ALTER TABLE defects ADD COLUMN measure TEXT NOT NULL DEFAULT '';
-- Bekannte Geräte je Nutzer (Hinweis bei Anmeldung von neuem Gerät)
ALTER TABLE users ADD COLUMN known_devices TEXT NOT NULL DEFAULT '[]';

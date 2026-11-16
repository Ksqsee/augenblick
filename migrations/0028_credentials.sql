-- Plan v7 Paket X: Befähigungsnachweise je Mitglied (Sachkunde, Hersteller-Zertifikat, sonstiges).
-- Das Prüfprotokoll druckt je Elementart den passenden gültigen Nachweis der prüfenden Person (shared/credentials.ts).
CREATE TABLE member_credentials (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  -- expertise = Sachkunde/Befähigte Person, manufacturer = persönliches Hersteller-Zertifikat, other = sonstiges
  kind TEXT NOT NULL CHECK (kind IN ('expertise','manufacturer','other')),
  title TEXT NOT NULL DEFAULT '',
  issuer TEXT NOT NULL DEFAULT '',
  number TEXT NOT NULL DEFAULT '',
  -- Ende der Gültigkeit (ms, Ende des Tages in UTC); NULL = unbefristet
  valid_until INTEGER,
  -- Elementarten (JSON-Liste der Schlüssel); leer = gilt für alle
  categories TEXT NOT NULL DEFAULT '[]',
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX idx_member_credentials ON member_credentials(tenant_id, user_id);

-- Neuer Standard für Dateinamen von Prüfprotokollen: Ident, Datum, Art (alte Vorgabe ohne eigene Wahl umstellen)
UPDATE tenants SET pdf_pattern = '{code}_{datum}_{art}' WHERE pdf_pattern = '{datum}_{code}_{art}';

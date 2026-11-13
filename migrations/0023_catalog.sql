-- v5 Paket P: Katalog je Workspace (Produkte, typische Mängel, Begriffe) und laufende Nummern je Objekt.

-- Hersteller/Typ mit Vorgabewerten der Stammdaten (JSON) und Zulassung
CREATE TABLE catalog_products (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  manufacturer TEXT NOT NULL,
  model TEXT NOT NULL,
  -- Elementart (Schlüssel) oder '' = alle Arten
  category TEXT NOT NULL DEFAULT '',
  defaults TEXT NOT NULL DEFAULT '{}',
  approval TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  -- Vergleichsschlüssel (shared/vocab.ts entryKey): Hersteller|Typ ohne Schreibweise
  match_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_catalog_products ON catalog_products (tenant_id, match_key);

-- Typische Mängel mit Synonymen (JSON-Liste), Schwere und Maßnahme
CREATE TABLE catalog_defects (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  title TEXT NOT NULL,
  synonyms TEXT NOT NULL DEFAULT '[]',
  severity TEXT NOT NULL CHECK (severity IN ('low','medium','high','critical')),
  measure TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT '',
  match_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_catalog_defects ON catalog_defects (tenant_id, match_key);

-- Begriffe: Abkürzung → Bedeutung
CREATE TABLE catalog_terms (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  term TEXT NOT NULL,
  meaning TEXT NOT NULL,
  match_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_catalog_terms ON catalog_terms (tenant_id, match_key);

-- Grundausstattung genau einmal je Workspace (beim Anlegen bzw. beim ersten Lesen); gelöschte Einträge kommen nicht zurück
ALTER TABLE tenants ADD COLUMN catalog_seeded_at INTEGER;

-- Laufende Nummer je Objekt (über alle Arten); vorhandene Elemente bleiben ohne Nummer
ALTER TABLE assets ADD COLUMN number INTEGER;
CREATE INDEX idx_assets_number ON assets (tenant_id, number) WHERE number IS NOT NULL;

-- Zähler je Objekt: atomar hochgezählt (UPSERT … RETURNING), dadurch kollisionsfrei bei gleichzeitigem Anlegen
CREATE TABLE asset_counters (
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  property_id TEXT NOT NULL,
  last INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, property_id)
);

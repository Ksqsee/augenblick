-- Plan v7 Paket V: Elementart „Tür“ mit Anforderung, Katalog mit Aliassen, Zulassung bis, Leistungen und Zuordnung
-- Mangel → Leistung (Angebotsliste, worker/offer.ts).

-- Produkte: so, wie der Typ in Listen genannt wird (JSON-Liste), Zulassung gültig bis (JJJJ-MM-TT), Anforderung der Tür
ALTER TABLE catalog_products ADD COLUMN aliases TEXT NOT NULL DEFAULT '[]';
ALTER TABLE catalog_products ADD COLUMN approval_valid_until TEXT;
ALTER TABLE catalog_products ADD COLUMN requirement TEXT NOT NULL DEFAULT '';

-- Katalog-Mängel: zugeordnete Leistungen (JSON-Liste der Kürzel), Menge je Mangel, Notiz
ALTER TABLE catalog_defects ADD COLUMN service_keys TEXT NOT NULL DEFAULT '[]';
ALTER TABLE catalog_defects ADD COLUMN quantity REAL NOT NULL DEFAULT 1;
ALTER TABLE catalog_defects ADD COLUMN note TEXT NOT NULL DEFAULT '';

-- Leistungen: Kürzel, Bezeichnung, Einheit, Preis netto (Cent), Bedingung auf Stammdaten (JSON), Art
CREATE TABLE catalog_services (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  key TEXT NOT NULL,
  title TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT 'Stk',
  price_cents INTEGER NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  condition TEXT NOT NULL DEFAULT '{}',
  kind TEXT NOT NULL DEFAULT 'repair' CHECK (kind IN ('maintenance','repair','labor')),
  -- Elementart (Schlüssel) oder '' = alle Arten
  category TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  match_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX ux_catalog_services ON catalog_services (tenant_id, match_key);

-- Bestand Tür: Feuerwiderstand (rating) + Rauchschutz (smoke) → Anforderung (requirement). Nicht umrechenbare Werte
-- (z. B. T60) bleiben unverändert stehen; die App liest sie weiter (shared/catalog-door.ts requirementOf).
UPDATE assets SET attributes = json_remove(json_set(attributes, '$.requirement', (CASE
      WHEN upper(replace(replace(COALESCE(json_extract(attributes, '$.rating'), ''), ' ', ''), '-', '')) IN ('T30', 'EI230', 'EI30') THEN 'T30' || CASE WHEN (json_extract(attributes, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN '-RS' ELSE '' END
      WHEN upper(replace(replace(COALESCE(json_extract(attributes, '$.rating'), ''), ' ', ''), '-', '')) IN ('T90', 'EI290', 'EI90') THEN 'T90' || CASE WHEN (json_extract(attributes, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN '-RS' ELSE '' END
      WHEN upper(replace(replace(COALESCE(json_extract(attributes, '$.rating'), ''), ' ', ''), '-', '')) IN ('T0', 'OHNE', 'KEINE') THEN CASE WHEN (json_extract(attributes, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN 'RS' ELSE 'keine' END
      WHEN upper(replace(replace(COALESCE(json_extract(attributes, '$.rating'), ''), ' ', ''), '-', '')) = '' AND (json_extract(attributes, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN 'RS'
      ELSE NULL END)), '$.rating', '$.smoke')
 WHERE category = 'fire_door' AND json_valid(attributes) AND json_extract(attributes, '$.requirement') IS NULL
   AND (CASE
      WHEN upper(replace(replace(COALESCE(json_extract(attributes, '$.rating'), ''), ' ', ''), '-', '')) IN ('T30', 'EI230', 'EI30') THEN 'T30' || CASE WHEN (json_extract(attributes, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN '-RS' ELSE '' END
      WHEN upper(replace(replace(COALESCE(json_extract(attributes, '$.rating'), ''), ' ', ''), '-', '')) IN ('T90', 'EI290', 'EI90') THEN 'T90' || CASE WHEN (json_extract(attributes, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN '-RS' ELSE '' END
      WHEN upper(replace(replace(COALESCE(json_extract(attributes, '$.rating'), ''), ' ', ''), '-', '')) IN ('T0', 'OHNE', 'KEINE') THEN CASE WHEN (json_extract(attributes, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN 'RS' ELSE 'keine' END
      WHEN upper(replace(replace(COALESCE(json_extract(attributes, '$.rating'), ''), ' ', ''), '-', '')) = '' AND (json_extract(attributes, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN 'RS'
      ELSE NULL END) IS NOT NULL;

-- dasselbe für die Vorgabewerte der Katalog-Produkte
UPDATE catalog_products SET defaults = json_remove(json_set(defaults, '$.requirement', (CASE
      WHEN upper(replace(replace(COALESCE(json_extract(defaults, '$.rating'), ''), ' ', ''), '-', '')) IN ('T30', 'EI230', 'EI30') THEN 'T30' || CASE WHEN (json_extract(defaults, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN '-RS' ELSE '' END
      WHEN upper(replace(replace(COALESCE(json_extract(defaults, '$.rating'), ''), ' ', ''), '-', '')) IN ('T90', 'EI290', 'EI90') THEN 'T90' || CASE WHEN (json_extract(defaults, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN '-RS' ELSE '' END
      WHEN upper(replace(replace(COALESCE(json_extract(defaults, '$.rating'), ''), ' ', ''), '-', '')) IN ('T0', 'OHNE', 'KEINE') THEN CASE WHEN (json_extract(defaults, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN 'RS' ELSE 'keine' END
      WHEN upper(replace(replace(COALESCE(json_extract(defaults, '$.rating'), ''), ' ', ''), '-', '')) = '' AND (json_extract(defaults, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN 'RS'
      ELSE NULL END)), '$.rating', '$.smoke')
 WHERE category = 'fire_door' AND json_valid(defaults) AND json_extract(defaults, '$.requirement') IS NULL
   AND (CASE
      WHEN upper(replace(replace(COALESCE(json_extract(defaults, '$.rating'), ''), ' ', ''), '-', '')) IN ('T30', 'EI230', 'EI30') THEN 'T30' || CASE WHEN (json_extract(defaults, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN '-RS' ELSE '' END
      WHEN upper(replace(replace(COALESCE(json_extract(defaults, '$.rating'), ''), ' ', ''), '-', '')) IN ('T90', 'EI290', 'EI90') THEN 'T90' || CASE WHEN (json_extract(defaults, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN '-RS' ELSE '' END
      WHEN upper(replace(replace(COALESCE(json_extract(defaults, '$.rating'), ''), ' ', ''), '-', '')) IN ('T0', 'OHNE', 'KEINE') THEN CASE WHEN (json_extract(defaults, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN 'RS' ELSE 'keine' END
      WHEN upper(replace(replace(COALESCE(json_extract(defaults, '$.rating'), ''), ' ', ''), '-', '')) = '' AND (json_extract(defaults, '$.smoke') IN (1, '1', 'true', 'ja', 'Ja', 'JA')) THEN 'RS'
      ELSE NULL END) IS NOT NULL;
UPDATE catalog_products SET requirement = json_extract(defaults, '$.requirement')
 WHERE category = 'fire_door' AND json_valid(defaults) AND json_extract(defaults, '$.requirement') IS NOT NULL AND requirement = '';

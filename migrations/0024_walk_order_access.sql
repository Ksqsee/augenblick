-- v6 Paket T: Laufreihenfolge der Elemente (A3) und Zugang zum Objekt (F4).

-- Reihenfolge innerhalb eines Gebäudes in der Anlage-Reihenfolge (setup, Erfassen); der Rundgang sortiert nach
-- Etage (von unten nach oben) und dann danach (shared/walk-order.ts).
ALTER TABLE assets ADD COLUMN sort_index INTEGER;

-- Bestand: je Gebäude nach laufender Nummer, dann Anlagezeit, dann Code
UPDATE assets SET sort_index = (
  SELECT COUNT(*) + 1 FROM assets x
   WHERE x.building_id = assets.building_id
     AND (
       (x.number IS NOT NULL AND assets.number IS NULL)
       OR (COALESCE(x.number, -1) < COALESCE(assets.number, -1) AND (x.number IS NULL) = (assets.number IS NULL))
       OR (COALESCE(x.number, -1) = COALESCE(assets.number, -1) AND (x.number IS NULL) = (assets.number IS NULL)
           AND (x.created_at < assets.created_at OR (x.created_at = assets.created_at AND x.code < assets.code)))
     )
);

-- Zugang: Schlüssel, Zeiten, Hinweise (Freitext)
ALTER TABLE properties ADD COLUMN access TEXT NOT NULL DEFAULT '';

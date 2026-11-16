-- Plan v7 Paket W: Rohdiktat an der Prüfung. Liste aus {id, text, at, source (app|offline|mcp), kind
-- (announce|finding|type), evaluated, evaluatedAt, critical, summary} als JSON. Der Regel-Parser ordnet sofort grob
-- ein; Claude wertet später über den Connector aus und markiert die Einträge als ausgewertet (MCP inspect).
ALTER TABLE inspections ADD COLUMN raw_notes TEXT NOT NULL DEFAULT '[]';

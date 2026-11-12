-- Prüfungsentwurf „bereit zur Unterschrift“: vollständig ausgefüllt (z. B. von Claude über den MCP-Server),
-- wartet nur noch auf die Unterschrift der prüfenden Person in der App (POST /inspections/sign).
-- NULL = nicht bereit. Wird beim Bearbeiten zu „unvollständig“ wieder geleert.
ALTER TABLE inspections ADD COLUMN ready_at INTEGER;

CREATE INDEX idx_inspections_ready ON inspections (tenant_id, inspector_id, ready_at) WHERE ready_at IS NOT NULL;

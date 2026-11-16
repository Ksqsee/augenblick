// Team und Workspace für API und MCP (Plan v6 B1, E1): wer kann Aufgaben übernehmen (Mitglieder mit Rolle, Partner)
// und in welcher Zeitzone arbeitet der Workspace. Lesend, mit Sitzung oder Schlüssel. Sichtbar ist, was auch die App
// jedem Mitglied zeigt (Team-Liste, Subunternehmer) – ohne Zugriffsbereiche, Einladungen oder Partner-Zugangsdaten.
import { Hono } from 'hono';
import { type AppEnv, RANK } from './lib';

export const team = new Hono<AppEnv>();
const tid = (c: { get: (k: 'user') => { tenantId: string } }) => c.get('user').tenantId;

/** Name, Zeitzone und die eigene Person (bei Schlüsseln: wer ihn erstellt hat, mit der Rolle des Schlüssels). */
team.get('/workspace', async (c) => {
  const u = c.get('user');
  const [t, me] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT name, timezone AS timeZone, language FROM tenants WHERE id = ?').bind(tid(c)),
    c.env.DB.prepare('SELECT name, email FROM users WHERE id = ?').bind(u.userId),
  ]);
  const tenant = t.results[0] as { name: string; timeZone: string | null; language: string } | undefined;
  const person = me.results[0] as { name: string; email: string } | undefined;
  return c.json({
    name: tenant?.name ?? '',
    timeZone: tenant?.timeZone || 'Europe/Berlin',
    language: tenant?.language ?? 'de',
    me: { id: u.userId, name: person?.name ?? u.name, email: person?.email ?? '', role: u.role, scoped: !!u.scope, viaKey: !!u.apiKeyId },
  });
});

/**
 * Mitglieder (Name, E-Mail, Rolle, darf Aufgaben übernehmen) und Partner (Subunternehmer). Grundlage für
 * Zuweisungen per Name, E-Mail oder „ich“ in allen MCP-Werkzeugen.
 */
team.get('/team', async (c) => {
  const [members, partners] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT u.id, u.name, u.email, m.role, m.scope IS NOT NULL AND m.role NOT IN ('owner','admin') AS scoped
         FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.tenant_id = ? ORDER BY u.name COLLATE NOCASE`,
    ).bind(tid(c)),
    c.env.DB.prepare('SELECT id, company, contact_name AS contactName, trade FROM subcontractors WHERE tenant_id = ? AND deleted_at IS NULL ORDER BY company COLLATE NOCASE').bind(tid(c)),
  ]);
  return c.json({
    me: c.get('user').userId,
    members: (members.results as { id: string; name: string; email: string; role: keyof typeof RANK; scoped: number }[]).map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      role: m.role,
      // Aufgaben bearbeiten dürfen Prüfer und höher
      canTakeTasks: RANK[m.role] >= RANK.inspector,
      scoped: !!m.scoped,
    })),
    partners: partners.results,
  });
});

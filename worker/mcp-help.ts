// Hilfen für die MCP-Werkzeuge des Kreislaufs (Plan v6 Paket U): Workspace-Zeitzone, Datumsangaben (shared/dates.ts),
// Personen und Partner per Name, E-Mail oder „ich“ (B1) und fällige Begehungen aus einer Quelle (E4).
// Wie alle Werkzeuge nur über die normale API – Rechte und Zugriffsbereich gelten unverändert.
import { DateInputError, type DateInputOptions, dayIn, dayTimeIn, parseDateInput } from '../shared/dates';
import { foldText } from '../shared/vocab';
import { type Api, type Json, ToolError } from './mcp-tools';

type X = { api: Api };

export interface Workspace {
  name: string;
  timeZone: string;
  me: { id: string; name: string; email: string; role: string };
}
export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  canTakeTasks: boolean;
  scoped: boolean;
}
export interface Partner {
  id: string;
  company: string;
  contactName: string;
  trade: string;
}
export interface Team {
  me: string;
  members: TeamMember[];
  partners: Partner[];
}

// je Werkzeug-Aufruf zwischengespeichert (der Kontext lebt nur für einen Aufruf)
const wsCache = new WeakMap<object, Promise<Workspace>>();
const teamCache = new WeakMap<object, Promise<Team>>();

export const workspace = (x: X) => {
  let p = wsCache.get(x);
  if (!p) {
    p = (x.api({ method: 'GET', path: '/workspace' }) as Promise<Workspace>).catch(
      () => ({ name: '', timeZone: 'Europe/Berlin', me: { id: '', name: '', email: '', role: '' } }) as Workspace,
    );
    wsCache.set(x, p);
  }
  return p;
};
export const team = (x: X) => {
  let p = teamCache.get(x);
  if (!p) {
    p = x.api({ method: 'GET', path: '/team' }) as Promise<Team>;
    teamCache.set(x, p);
  }
  return p;
};

/** Zeitzone des Workspaces (E1). */
export const tzOf = async (x: X) => (await workspace(x)).timeZone || 'Europe/Berlin';

/**
 * Datum aus einer Werkzeug-Eingabe (ISO streng, „30.11.“, „morgen“, „Freitag“, „in 3 Tagen“, „Ende des Monats“),
 * Zeiten ohne Zone in der Zeitzone des Workspaces. Ungültiges oder (ohne allowPast) Vergangenes → ToolError.
 */
export async function dateArg(x: X, v: unknown, field: string, o: Omit<DateInputOptions, 'timeZone' | 'field'> = {}) {
  if (v == null || v === '') return undefined;
  try {
    return parseDateInput(v, { ...o, field, timeZone: await tzOf(x) }).at;
  } catch (e) {
    if (e instanceof DateInputError) throw new ToolError(e.message);
    throw e;
  }
}

/** Darstellung in der Zeitzone des Workspaces. */
export async function fmt(x: X) {
  const tz = await tzOf(x);
  return {
    tz,
    day: (ms: unknown) => (typeof ms === 'number' && ms > 0 ? dayIn(ms, tz) : null),
    dayTime: (ms: unknown) => (typeof ms === 'number' && ms > 0 ? dayTimeIn(ms, tz) : null),
  };
}

export type Person = { kind: 'member'; id: string; name: string } | { kind: 'partner'; id: string; name: string };

const ME = new Set(['ich', 'mir', 'mich', 'me', 'selbst', 'mein', 'meine']);
const ROLE: Record<string, string> = { owner: 'Inhaber', admin: 'Admin', inspector: 'Prüfer', viewer: 'Lesezugriff' };
export const roleLabel = (r: string) => ROLE[r] ?? r;

/**
 * Person oder Partner per Name, E-Mail, ID oder „ich“ – über alle Mitglieder und Partner des Workspaces (B1).
 * Mehrdeutig → Fehler mit Auswahl; nicht gefunden → Fehler mit allen Namen. `allowPartner: false` nur Mitglieder.
 */
export async function resolvePerson(x: X, q: unknown, opts: { allowPartner?: boolean } = {}): Promise<Person> {
  const raw = String(q ?? '').trim();
  const t = await team(x);
  const members = t.members.filter((m) => m.canTakeTasks);
  const partners = opts.allowPartner === false ? [] : t.partners;
  const v = foldText(raw);
  const asMember = (m: TeamMember): Person => ({ kind: 'member', id: m.id, name: m.name });
  const asPartner = (p: Partner): Person => ({ kind: 'partner', id: p.id, name: p.company });
  if (ME.has(v)) {
    const me = t.members.find((m) => m.id === t.me);
    if (!me) throw new ToolError('„ich“ ist mit diesem Zugang nicht auflösbar – bitte den Namen nennen.');
    if (!me.canTakeTasks) throw new ToolError(`${me.name} hat nur Lesezugriff und kann keine Aufgaben übernehmen.`);
    return asMember(me);
  }
  const all = [
    ...members.map((m) => ({ p: asMember(m), keys: [m.id, m.name, m.email], first: m.name.split(/\s+/)[0] ?? '' })),
    ...partners.map((p) => ({ p: asPartner(p), keys: [p.id, p.company, p.contactName], first: '' })),
  ];
  const fold = (s: string) => foldText(s ?? '');
  const exact = all.filter((e) => e.keys.some((k) => k && (k === raw || fold(k) === v)));
  const pick = (hits: typeof all) => {
    const uniq = [...new Map(hits.map((h) => [`${h.p.kind}:${h.p.id}`, h])).values()];
    if (uniq.length === 1) return uniq[0].p;
    if (uniq.length > 1)
      throw new ToolError(
        `„${raw}“ ist mehrdeutig: ${uniq
          .slice(0, 10)
          .map((h) => (h.p.kind === 'partner' ? `${h.p.name} (Partner)` : `${h.p.name} (${t.members.find((m) => m.id === h.p.id)?.email ?? ''})`))
          .join(', ')}. Bitte genauer angeben, z. B. mit E-Mail.`,
      );
    return null;
  };
  const viaExact = pick(exact);
  if (viaExact) return viaExact;
  if (v.length >= 2) {
    const firstName = all.filter((e) => e.first && fold(e.first) === v);
    const viaFirst = pick(firstName);
    if (viaFirst) return viaFirst;
    const partial = all.filter((e) => e.keys.some((k) => k && fold(k).includes(v)));
    const viaPartial = pick(partial);
    if (viaPartial) return viaPartial;
  }
  const readOnly = t.members.find((m) => !m.canTakeTasks && (fold(m.name) === v || fold(m.email) === v));
  if (readOnly) throw new ToolError(`${readOnly.name} hat nur Lesezugriff und kann keine Aufgaben übernehmen.`);
  throw new ToolError(
    `„${raw}“ ist weder Mitglied noch Partner. Möglich: ${[...members.map((m) => m.name), ...partners.map((p) => `${p.company} (Partner)`)].join(', ') || 'niemand'}. Alle mit Rolle zeigt team.`,
  );
}

/**
 * Fällige Begehungen – eine Quelle für briefing und list (E4), dieselbe Regel wie „Jetzt“: Objekte, deren nächste
 * Begehung in 30 Tagen fällig oder überfällig ist; Objekte ohne Begehung nur, wenn der Workspace je eine begonnen hat.
 */
export async function walkthroughsDue(x: X, now = Date.now()) {
  const [props, walks] = await Promise.all([
    x.api({ method: 'GET', path: '/properties' }) as Promise<Json[]>,
    x.api({ method: 'GET', path: '/walkthroughs' }).catch(() => []) as Promise<Json[]>,
  ]);
  const walkedEver = walks.length > 0;
  return props
    .filter((p) => (p.nextWalkAt == null ? walkedEver : Number(p.nextWalkAt) < now + 30 * 86_400_000))
    .map((p) => ({ propertyId: String(p.id), property: String(p.name), nextDue: p.nextWalkAt == null ? null : Number(p.nextWalkAt), overdue: p.nextWalkAt == null || Number(p.nextWalkAt) < now }));
}

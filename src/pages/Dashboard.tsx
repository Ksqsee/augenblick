// „Heute“ (Design v3, Vorzeigeseite): Datum + Lage in einem Satz, Kennzahlen ohne Kasten, „Jetzt“, Rundgänge,
// „Erledigt für dich“ (Autopilot-Protokoll). Rechte Spalte auf dem Grund: Objekte und offene Aufgaben.
// Aufbau: docs/plan/v3.md 2.5, Regeln: docs/design.md
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Plus, ScanLine } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useDashboard, useMe } from '../api';
import { Button, ButtonLink, Empty, ErrorBox, List, ListRow, PageSkeleton, Section, SectionLink, StatTile, StatusDot, StatusText, Surface, useToast } from '../components/ui';
import { defectsLabel, fmtDate, fmtRelative, type Tone } from '../format';

export interface Suggestion {
  id: string;
  kind: string;
  tone: 'bad' | 'warn' | 'info';
  title: string;
  text: string;
  link?: string;
  action?: { label: string; endpoint: string; body?: unknown };
  count: number;
}
export interface Round {
  buildingId: string;
  buildingName: string;
  propertyId: string;
  propertyName: string;
  overdue: number;
  due: number;
  never: number;
  earliest: number | null;
  assets: {
    id: string;
    code: string;
    category: string;
    location: string;
    floor: string;
    nextDueAt: number | null;
  }[];
}

export const useSuggestions = () =>
  useQuery({
    queryKey: ['smart', 'suggestions'],
    queryFn: () => api<Suggestion[]>('/smart/suggestions'),
  });
export const useRounds = (days = 30) =>
  useQuery({
    queryKey: ['smart', 'rounds', days],
    queryFn: () => api<Round[]>(`/smart/rounds?days=${days}`),
  });

/** Eintrag im Autopilot-Protokoll (Paket B). Felder defensiv, camelCase oder snake_case. */
interface AutomationEntry {
  id: string;
  at?: number;
  summary: string;
  undo?: unknown;
  undoable?: boolean;
  canUndo?: boolean;
  undoneAt?: number | null;
  undone_at?: number | null;
}

const dayFmt = new Intl.DateTimeFormat('de-DE', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
});
const timeFmt = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
});
const shortFmt = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
});

const n = (v: number, one: string, many: string) => `${v} ${v === 1 ? one : many}`;

/** Lage in einem Satz. Zahlen in Tinte, „überfällig/kritisch“ in Zinnober, Rest grau. */
function Situation({ assets, overdue, critical, soon, never, nextDue }: { assets: number; overdue: number; critical: number; soon: number; never: number; nextDue: number | null }) {
  if (assets === 0) return <>Noch keine Elemente angelegt.</>;
  const Num = ({ children }: { children: ReactNode }) => <span className="text-ink tabular-nums">{children}</span>;
  const Shu = ({ children }: { children: ReactNode }) => <span className="text-shu">{children}</span>;
  if (overdue > 0 || critical > 0) {
    return (
      <>
        {/* je Satzteil ohne Umbruch – der Zeilenfall folgt der Bedeutung */}
        {overdue > 0 && (
          <span className="whitespace-nowrap">
            <Num>{overdue}</Num> {overdue === 1 ? 'Prüfung ist' : 'Prüfungen sind'} <Shu>überfällig</Shu>
            {critical > 0 ? ',' : '.'}
          </span>
        )}
        {overdue > 0 && critical > 0 && ' '}
        {critical > 0 && (
          <span className="whitespace-nowrap">
            <Num>{critical}</Num> {critical === 1 ? 'Mangel' : 'Mängel'}
            {overdue > 0 ? ' ' : critical === 1 ? ' ist ' : ' sind '}
            <Shu>kritisch</Shu>.
          </span>
        )}
      </>
    );
  }
  if (soon > 0)
    return (
      <>
        Nichts überfällig. <Num>{soon}</Num> {soon === 1 ? 'Prüfung wird' : 'Prüfungen werden'} in 30 Tagen fällig.
      </>
    );
  if (never > 0)
    return (
      <>
        Nichts überfällig. <Num>{never}</Num> {never === 1 ? 'Element ist' : 'Elemente sind'} noch nie geprüft.
      </>
    );
  return (
    <>
      Alles geprüft.
      {nextDue ? ` Nächste Fälligkeit am ${fmtDate(nextDue)}.` : ''}
    </>
  );
}

/** Abhak-Kreis vor einem Eintrag unter „Jetzt“ – Zinnober nur, wenn es brennt. */
function Ring({ tone }: { tone: Suggestion['tone'] }) {
  return <span aria-hidden className={clsx('mt-[3px] size-3.5 shrink-0 rounded-full border-[1.5px]', tone === 'bad' ? 'border-shu' : 'border-ink-4')} />;
}

function SuggestionRow({ s }: { s: Suggestion }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!s.action) return;
    setBusy(true);
    try {
      const r = await api<{ created?: number }>(s.action.endpoint, {
        body: s.action.body ?? {},
      });
      toast(r.created != null ? `${r.created} Aufgaben angelegt` : 'Erledigt');
      for (const k of ['smart', 'tasks', 'dashboard', 'automation']) qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Fehlgeschlagen', 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="animate-pop flex min-h-[52px] items-start gap-3 px-(--row-px) py-3 sm:items-center">
      <Ring tone={s.tone} />
      <div className="flex min-w-0 flex-1 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-body text-ink">{s.title}</p>
          <p className="mt-0.5 text-meta text-ink-3">{s.text}</p>
        </div>
        {s.action ? (
          <Button size="sm" variant="secondary" loading={busy} onClick={run}>
            {s.action.label}
          </Button>
        ) : s.link ? (
          <Button size="sm" variant="ghost" className="text-ink max-sm:-ml-3" onClick={() => navigate(s.link!)} aria-label={`${s.title} öffnen`}>
            {s.kind === 'round' ? 'Starten' : 'Öffnen'}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function roundStatus(r: Round): { tone: Tone; text: string } {
  if (r.overdue && r.earliest)
    return {
      tone: 'bad',
      text: `seit ${fmtRelative(r.earliest).replace(/^vor /, '')} überfällig`,
    };
  if (r.earliest) return { tone: 'warn', text: `fällig ab ${fmtDate(r.earliest)}` };
  return { tone: 'info', text: 'nie geprüft' };
}

/** „Erledigt für dich“: letzte Einträge des Autopilot-Protokolls. Ohne Endpunkt (404) oder ohne Einträge unsichtbar. */
function DoneForYou() {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const log = useQuery({
    queryKey: ['automation', 'log', 5],
    queryFn: async () => {
      const r = await api<AutomationEntry[] | { items?: AutomationEntry[]; log?: AutomationEntry[] }>('/automation/log?limit=5');
      return Array.isArray(r) ? r : (r.items ?? r.log ?? []);
    },
    retry: false,
    staleTime: 60_000,
  });
  const items = (log.data ?? []).slice(0, 5);
  if (!items.length) return null;
  const today = new Date().toDateString();
  const undo = async (id: string) => {
    setBusy(id);
    try {
      await api(`/automation/log/${id}/undo`, { method: 'POST' });
      toast('Rückgängig gemacht');
      for (const k of ['automation', 'smart', 'tasks', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Fehlgeschlagen', 'bad');
    } finally {
      setBusy(null);
    }
  };
  return (
    <Section title="Erledigt für dich" action={<SectionLink to="/einstellungen?tab=automation">Alle</SectionLink>} flush>
      <ul className="pk-list" aria-label="Erledigt für dich">
        {items.map((e) => {
          const undone = e.undoneAt ?? e.undone_at;
          const canUndo = !undone && (e.undoable ?? e.canUndo ?? (e.undo != null && e.undo !== ''));
          const at = e.at ? (new Date(e.at).toDateString() === today ? timeFmt.format(e.at) : shortFmt.format(e.at)) : '';
          return (
            <li key={e.id} className="flex min-h-11 items-center gap-3 px-(--row-px) py-2.5 text-body">
              <span className="w-11 shrink-0 text-meta text-ink-3 tabular-nums">{at}</span>
              <span className={clsx('min-w-0 flex-1', undone ? 'text-ink-3 line-through decoration-ink-4' : 'text-ink')}>{e.summary}</span>
              {canUndo && (
                <button
                  type="button"
                  disabled={busy === e.id}
                  onClick={() => undo(e.id)}
                  className="shrink-0 text-meta font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
                >
                  Rückgängig
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function propertyStatus(p: { overdue: number | null; soon: number | null; openDefects: number; never: number | null; assets: number }): { tone: Tone; label: string } {
  if ((p.overdue ?? 0) > 0) return { tone: 'bad', label: `${p.overdue} überfällig` };
  if (p.openDefects > 0) return { tone: 'warn', label: defectsLabel(p.openDefects) };
  if ((p.soon ?? 0) > 0) return { tone: 'warn', label: `${p.soon} bald fällig` };
  if ((p.never ?? 0) > 0) return { tone: 'info', label: `${p.never} ungeprüft` };
  if (p.assets === 0) return { tone: 'muted', label: 'leer' };
  return { tone: 'ok', label: 'aktuell' };
}

/** Überschrift einer Seitenspalte (auf dem Grund, ohne Karte). */
function AsideHead({ title, to }: { title: string; to: string }) {
  return (
    <div className="mb-1 flex h-7 items-center justify-between">
      <h2 className="text-meta font-medium text-ink-3">{title}</h2>
      <SectionLink to={to}>Alle</SectionLink>
    </div>
  );
}

export function Dashboard() {
  const { data: me } = useMe();
  const { data, isLoading, error, refetch } = useDashboard();
  const sugg = useSuggestions();
  const rounds = useRounds(30);
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorBox error={error} onRetry={() => refetch()} />;
  const c = data.counts;
  const canWrite = me?.user.role !== 'viewer';
  const topRound = rounds.data?.find((r) => r.overdue + r.due > 0);
  // Rundgänge stehen in eigener Liste – unter „Jetzt“ nur das Übrige
  const next = (sugg.data ?? []).filter((s) => s.kind !== 'round');
  const nextDue = (rounds.data ?? []).reduce<number | null>((m, r) => (r.earliest && (!m || r.earliest < m) ? r.earliest : m), null);
  const defects = c.openDefects + c.openWalkDefects;
  const stats: { to: string; tone: Tone; label: string; value: number }[] = [
    {
      to: '/pruefungen?tab=overdue',
      tone: 'bad',
      label: 'Überfällig',
      value: c.overdue,
    },
    {
      to: '/pruefungen?tab=soon',
      tone: 'warn',
      label: 'Bald fällig',
      value: c.soon,
    },
    {
      to: '/pruefungen?tab=never',
      tone: 'info',
      label: 'Nie geprüft',
      value: c.never,
    },
    {
      to: '/maengel',
      tone: 'brand',
      label: defects === 1 ? 'Mangel offen' : 'Mängel offen',
      value: defects,
    },
    {
      to: '/pruefungen?tab=done',
      tone: 'ok',
      label: 'Geprüft, 30 T.',
      value: c.inspections30d,
    },
  ];

  return (
    <div className="grid grid-cols-1 gap-10 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-10">
      <Surface>
        <header className="flex flex-col gap-5 px-(--row-px) pt-5 pb-6 sm:pt-7 sm:pb-8">
          {/* Zeile 1: Datum + Aktionen; Zeile 2: die Lage als Satz (h1), darf unter die Aktionen laufen */}
          <div className="flex flex-col gap-1 sm:block">
            {canWrite && (
              <div className="order-last mt-4 flex items-center gap-1 sm:float-right sm:mt-0 sm:ml-6">
                {topRound && <ButtonLink to={`/rundgang/${topRound.buildingId}`}>Rundgang starten</ButtonLink>}
                <ButtonLink to="/scan" variant="ghost" icon={<ScanLine />} aria-label="Code scannen" title="Code scannen" className="px-2.5 sm:px-2.5">
                  <span className="sm:sr-only">Scannen</span>
                </ButtonLink>
              </div>
            )}
            <p className="text-[24px] leading-[30px] font-semibold tracking-[-0.02em] text-ink sm:text-h1">{dayFmt.format(Date.now())}</p>
            <h1 className="text-[24px] leading-[30px] font-medium tracking-[-0.02em] text-pretty text-ink-3 sm:text-h1">
              <Situation assets={c.assets} overdue={c.overdue} critical={c.criticalDefects} soon={c.soon} never={c.never} nextDue={nextDue} />
            </h1>
          </div>
        </header>

        {c.assets === 0 ? (
          <Section>
            <Empty
              title="Lege dein erstes Objekt an"
              text="Objekte sind Liegenschaften, z. B. eine Schule oder ein Bürogebäude. Darin legst du Gebäude und die zu prüfenden Elemente an."
              action={
                <Link to="/objekte?neu=1">
                  <Button icon={<Plus />}>Objekt anlegen</Button>
                </Link>
              }
            />
          </Section>
        ) : (
          <Section title="Prüfstatus" action={<span className="text-meta text-ink-3">{`${c.assets} Elemente in ${c.properties} Objekten`}</span>}>
            <div className="grid grid-cols-3 gap-y-5 pt-1 sm:flex sm:gap-0">
              {stats.map((s, i) => (
                <StatTile
                  key={s.label}
                  to={s.to}
                  tone={s.tone}
                  label={s.label}
                  value={s.value}
                  divider={false}
                  className={clsx('border-line whitespace-nowrap sm:flex-auto sm:px-4 sm:first:pl-0', i % 3 !== 0 && 'max-sm:border-l max-sm:pl-4', i > 0 && 'sm:border-l')}
                />
              ))}
            </div>
          </Section>
        )}

        {next.length > 0 && (
          <Section title="Jetzt" count={next.length} flush>
            <ul className="pk-list" aria-label="Jetzt">
              {next.map((s) => (
                <SuggestionRow key={s.id} s={s} />
              ))}
            </ul>
          </Section>
        )}

        {c.assets > 0 && (
          <Section title="Rundgänge" action={<span className="text-meta text-ink-3">fällig in 30 Tagen</span>} flush>
            {rounds.data && rounds.data.length === 0 ? (
              <p className="px-(--row-px) pb-3 text-body text-ink-2">In den nächsten 30 Tagen ist nichts fällig.</p>
            ) : (
              <List plain aria-label="Rundgänge">
                {(rounds.data ?? []).slice(0, 6).map((r) => {
                  const st = roundStatus(r);
                  return (
                    <ListRow
                      key={r.buildingId}
                      to={`/rundgang/${r.buildingId}`}
                      chevron
                      title={
                        <>
                          {r.buildingName}
                          <span className="text-ink-3"> · {r.propertyName}</span>
                        </>
                      }
                      subtitle={
                        <span className="flex items-center gap-1.5">
                          <span className="tabular-nums">{n(r.assets.length, 'Element', 'Elemente')}</span>
                          <span aria-hidden>·</span>
                          <StatusText tone={st.tone}>{st.text}</StatusText>
                        </span>
                      }
                    />
                  );
                })}
              </List>
            )}
          </Section>
        )}

        <DoneForYou />
      </Surface>

      <aside className="flex min-w-0 flex-col gap-8 lg:pt-2" aria-label="Überblick">
        <section>
          <AsideHead title="Objekte" to="/objekte" />
          {data.properties.length === 0 ? (
            <p className="py-2 text-body text-ink-2">Noch keine Objekte.</p>
          ) : (
            <ul className="border-t border-line">
              {data.properties.slice(0, 6).map((p) => {
                const s = propertyStatus(p);
                return (
                  <li key={p.id} className="border-b border-line">
                    <Link to={`/objekte/${p.id}`} className="group flex min-h-11 items-center gap-3 py-2 text-body">
                      <span className="min-w-0 flex-1 truncate text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">{p.name}</span>
                      <StatusText tone={s.tone} className="shrink-0">
                        {s.label}
                      </StatusText>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {data.tasks.length > 0 && (
          <section>
            <AsideHead title="Offene Aufgaben" to="/aufgaben" />
            <ul className="border-t border-line">
              {data.tasks.map((t) => {
                const late = !!t.dueAt && t.dueAt < Date.now();
                return (
                  <li key={t.id} className="border-b border-line">
                    <Link to={`/aufgaben?id=${t.id}`} className="group flex min-h-11 items-center gap-3 py-2 text-body">
                      {t.priority === 'high' && <StatusDot tone="bad" label="Hohe Priorität" />}
                      <span className="min-w-0 flex-1 truncate text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">{t.title}</span>
                      <span className={clsx('shrink-0 text-meta tabular-nums', late ? 'text-shu' : 'text-ink-3')}>{t.dueAt ? fmtDate(t.dueAt) : ''}</span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}

        {data.recent.length > 0 && (
          <p className="text-meta text-ink-3">
            Zuletzt geprüft:{' '}
            <Link to="/pruefungen?tab=done" className="text-ink-2 hover:text-ink">
              {data.recent[0].code}
            </Link>{' '}
            {fmtRelative(data.recent[0].inspectedAt)}
          </p>
        )}
      </aside>
    </div>
  );
}

// „Heute“: was jetzt zu tun ist – Lage, Schnellstart, Prüfstatus, Vorschläge, Rundgänge.
// Vorlage „Dashboard“ aus docs/design.md.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, Building2, CalendarClock, ClipboardCheck, Clock, Footprints, Info, Mic, Plus, ScanLine } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useDashboard, useMe } from '../api';
import { openCapture } from '../components/CaptureSheet';
import { Badge, Button, Card, Empty, ErrorBox, List, ListRow, PageSkeleton, RowIcon, SectionHeader, SectionLink, StatusDot, toneDot, useToast } from '../components/ui';
import { defectsLabel, fmtDate, fmtLong, fmtRelative, greeting, type Tone } from '../format';

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
  assets: { id: string; code: string; category: string; location: string; floor: string; nextDueAt: number | null }[];
}

export const useSuggestions = () => useQuery({ queryKey: ['smart', 'suggestions'], queryFn: () => api<Suggestion[]>('/smart/suggestions') });
export const useRounds = (days = 30) => useQuery({ queryKey: ['smart', 'rounds', days], queryFn: () => api<Round[]>(`/smart/rounds?days=${days}`) });

/** Schnellstart-Kachel: Symbol, Titel, eine Zeile. accent = Signalfarbe nur am Symbol. */
function ActionTile({ onClick, to, icon, title, text, accent, className }: { onClick?: () => void; to?: string; icon: ReactNode; title: string; text: string; accent?: boolean; className?: string }) {
  const cls = clsx(
    'group flex min-w-0 flex-col items-start gap-3 rounded-xl bg-surface p-3.5 text-left shadow-card transition-[box-shadow,transform] hover:shadow-lift active:scale-[0.99] sm:flex-row sm:items-center',
    className,
  );
  const body = (
    <>
      <span className={clsx('grid size-10 shrink-0 place-items-center rounded-lg [&>svg]:size-[18px]', accent ? 'bg-brand text-white' : 'bg-sunken text-ink')}>{icon}</span>
      <span className="w-full min-w-0 flex-1">
        <span className="block truncate text-body font-semibold">{title}</span>
        <span className="line-clamp-2 block text-meta text-ink-3 sm:truncate">{text}</span>
      </span>
      <ArrowRight className="hidden size-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5 group-hover:text-ink-2 sm:block" />
    </>
  );
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {body}
    </button>
  );
}

/** Eine Kennzahl im Prüfstatus-Streifen. */
function StatusCell({ to, tone, label, value, className }: { to: string; tone: Tone; label: string; value: number; className?: string }) {
  return (
    <Link to={to} className={clsx('group flex flex-col gap-1 px-4 py-3.5 transition-colors hover:bg-hover sm:py-4', className)}>
      <span className="flex items-center gap-1.5 text-meta text-ink-2">
        <StatusDot tone={tone} />
        {label}
      </span>
      <span className={clsx('text-[26px] leading-8 font-semibold tracking-[-0.02em] tabular-nums', value === 0 && 'text-ink-4')}>{value}</span>
    </Link>
  );
}

/** Verteilung aller Elemente nach Prüfstatus als dünner Balken. */
function DistributionBar({ parts, total }: { parts: { tone: Tone; value: number; label: string }[]; total: number }) {
  if (total <= 0) return null;
  return (
    <div className="flex h-1.5 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(', ')}>
      {parts
        .filter((p) => p.value > 0)
        .map((p) => (
          <span key={p.label} className={clsx('h-full first:rounded-l-full last:rounded-r-full', toneDot[p.tone])} style={{ width: `${(p.value / total) * 100}%` }} />
        ))}
    </div>
  );
}

const suggestionIcon = { bad: <AlertTriangle />, warn: <Clock />, info: <Info /> };

function SuggestionRow({ s }: { s: Suggestion }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!s.action) return;
    setBusy(true);
    try {
      const r = await api<{ created?: number }>(s.action.endpoint, { body: s.action.body ?? {} });
      toast(r.created != null ? `${r.created} Aufgaben angelegt` : 'Erledigt');
      for (const k of ['smart', 'tasks', 'dashboard']) qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Fehlgeschlagen', 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="animate-pop flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
        <RowIcon tone={s.tone}>{suggestionIcon[s.tone]}</RowIcon>
        <div className="min-w-0 flex-1">
          <p className="text-body font-semibold">{s.title}</p>
          <p className="text-meta text-ink-3">{s.text}</p>
        </div>
      </div>
      <div className="flex shrink-0 justify-end pl-12 sm:pl-0">
        {s.action ? (
          <Button size="sm" loading={busy} onClick={run}>
            {s.action.label}
          </Button>
        ) : s.link ? (
          <Button size="sm" variant="secondary" onClick={() => navigate(s.link!)} aria-label={`${s.title} öffnen`}>
            {s.kind === 'round' ? 'Starten' : 'Öffnen'}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

function propertyTone(p: { overdue: number | null; soon: number | null; openDefects: number; never: number | null; assets: number }): { tone: Tone; label: string } {
  if ((p.overdue ?? 0) > 0) return { tone: 'bad', label: `${p.overdue} überfällig` };
  if (p.openDefects > 0) return { tone: 'warn', label: defectsLabel(p.openDefects) };
  if ((p.soon ?? 0) > 0) return { tone: 'warn', label: `${p.soon} bald fällig` };
  if ((p.never ?? 0) > 0) return { tone: 'info', label: `${p.never} ungeprüft` };
  if (p.assets === 0) return { tone: 'muted', label: 'Keine Elemente' };
  return { tone: 'ok', label: 'Alles aktuell' };
}

export function Dashboard() {
  const { data: me } = useMe();
  const { data, isLoading, error, refetch } = useDashboard();
  const sugg = useSuggestions();
  const rounds = useRounds(30);
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorBox error={error} onRetry={() => refetch()} />;
  const c = data.counts;
  const firstName = me?.user.name.split(' ')[0];
  const canWrite = me?.user.role !== 'viewer';
  const topRound = rounds.data?.find((r) => r.overdue + r.due > 0);
  // Rundgänge stehen schon in eigener Liste – bei den Vorschlägen nur das Übrige
  const next = (sugg.data ?? []).filter((s) => s.kind !== 'round');
  const now = Date.now();
  const okAssets = Math.max(0, c.assets - c.overdue - c.soon - c.never - c.notInspectable);
  const calm = c.overdue + c.criticalDefects === 0;

  return (
    <div className="flex flex-col gap-8 lg:gap-10">
      <header>
        <p className="text-meta text-ink-3">{fmtLong(now)}</p>
        <h1 className="mt-1 text-h1 font-semibold tracking-[-0.02em] sm:text-display">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-title text-ink-2">
          {calm ? (
            <span className="flex items-center gap-2">
              <StatusDot tone="ok" /> Alles im grünen Bereich.
            </span>
          ) : (
            <>
              {c.overdue > 0 && (
                <Link to="/pruefungen?tab=overdue" className="flex items-center gap-2 hover:text-ink">
                  <StatusDot tone="bad" /> {c.overdue} Prüfungen überfällig
                </Link>
              )}
              {c.criticalDefects > 0 && (
                <Link to="/maengel" className="flex items-center gap-2 hover:text-ink">
                  <StatusDot tone="bad" /> {c.criticalDefects} kritische Mängel
                </Link>
              )}
            </>
          )}
        </p>
      </header>

      {canWrite && (
        <section className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3" aria-label="Schnellstart">
          <ActionTile accent onClick={() => openCapture()} icon={<Mic />} title="Erfassen" text="Mangel, Aufgabe oder Notiz einsprechen" className="hidden sm:flex" />
          <ActionTile to="/scan" icon={<ScanLine />} title="Code scannen" text="Element finden und prüfen" />
          {topRound ? (
            <ActionTile
              to={`/rundgang/${topRound.buildingId}`}
              icon={<Footprints />}
              title="Rundgang starten"
              text={`${topRound.buildingName}: ${topRound.overdue + topRound.due + topRound.never} Elemente`}
            />
          ) : (
            <ActionTile to="/elemente?neu=1" icon={<Plus />} title="Element anlegen" text="Neues Prüfobjekt erfassen" />
          )}
        </section>
      )}

      {c.assets === 0 ? (
        <Card>
          <Empty
            icon={<Building2 />}
            title="Lege dein erstes Objekt an"
            text="Objekte sind Liegenschaften, z. B. eine Schule oder ein Bürogebäude. Darin legst du Gebäude und die zu prüfenden Elemente an."
            action={
              <Link to="/objekte?neu=1">
                <Button icon={<Plus />}>Objekt anlegen</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <section>
          <SectionHeader title="Prüfstatus" meta={`${c.assets} Elemente in ${c.properties} Objekten`} />
          <Card className="overflow-hidden">
            <div className="px-4 pt-4 pb-1">
              <DistributionBar
                total={c.assets}
                parts={[
                  { tone: 'bad', value: c.overdue, label: 'Überfällig' },
                  { tone: 'warn', value: c.soon, label: 'Bald fällig' },
                  { tone: 'info', value: c.never, label: 'Nie geprüft' },
                  { tone: 'muted', value: c.notInspectable, label: 'Nicht prüfbar' },
                  { tone: 'ok', value: okAssets, label: 'Aktuell' },
                ]}
              />
            </div>
            <div className="grid grid-cols-2 divide-line sm:grid-cols-5 sm:divide-x [&>*]:border-line max-sm:[&>*:nth-child(n+3)]:border-t max-sm:[&>*:nth-child(even)]:border-l">
              <StatusCell to="/pruefungen?tab=overdue" tone="bad" label="Überfällig" value={c.overdue} />
              <StatusCell to="/pruefungen?tab=soon" tone="warn" label="Bald fällig" value={c.soon} />
              <StatusCell to="/pruefungen?tab=never" tone="info" label="Nie geprüft" value={c.never} />
              <StatusCell to="/maengel" tone="brand" label="Offene Mängel" value={c.openDefects + c.openWalkDefects} />
              <StatusCell to="/pruefungen?tab=done" tone="ok" label="Geprüft (30 T.)" value={c.inspections30d} className="max-sm:col-span-2 max-sm:flex-row max-sm:items-center max-sm:justify-between max-sm:py-3 max-sm:[&>span:last-child]:text-xl" />
            </div>
          </Card>
        </section>
      )}

      {next.length > 0 && (
        <section>
          <SectionHeader title="Als Nächstes" count={next.length} />
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              {next.map((s) => (
                <SuggestionRow key={s.id} s={s} />
              ))}
            </ul>
          </Card>
        </section>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[1.35fr_1fr] lg:gap-6">
        <section className="min-w-0">
          <SectionHeader title="Rundgänge" meta="fällig in 30 Tagen, nach Gebäude" />
          {rounds.data && rounds.data.length === 0 ? (
            <Card>
              <Empty compact icon={<ClipboardCheck />} title="Nichts fällig" text="In den nächsten 30 Tagen steht keine Prüfung an." />
            </Card>
          ) : (
            <List aria-label="Rundgänge">
              {(rounds.data ?? []).slice(0, 6).map((r) => (
                <ListRow
                  key={r.buildingId}
                  to={`/rundgang/${r.buildingId}`}
                  chevron
                  leading={
                    <span
                      className={clsx(
                        'grid size-9 place-items-center rounded-lg text-meta font-semibold tabular-nums',
                        r.overdue ? 'bg-bad-soft text-bad' : 'bg-sunken text-ink-2',
                      )}
                    >
                      {r.assets.length}
                    </span>
                  }
                  title={r.buildingName}
                  tone={r.overdue ? 'bad' : undefined}
                  subtitle={
                    <>
                      {r.overdue && r.earliest ? `Überfällig seit ${fmtRelative(r.earliest).replace(/^vor /, '')}` : r.earliest ? `ab ${fmtDate(r.earliest)}` : 'ungeprüft'}
                      <span className="text-ink-3"> · {r.propertyName}</span>
                    </>
                  }
                />
              ))}
            </List>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-8">
          <section>
            <SectionHeader title="Objekte" action={<SectionLink to="/objekte">Alle</SectionLink>} />
            {data.properties.length === 0 ? (
              <Card>
                <Empty compact icon={<Building2 />} title="Noch keine Objekte" />
              </Card>
            ) : (
              <List>
                {data.properties.slice(0, 6).map((p) => {
                  const s = propertyTone(p);
                  return <ListRow key={p.id} to={`/objekte/${p.id}`} leading={<StatusDot tone={s.tone} />} title={p.name} trailing={<Badge tone={s.tone}>{s.label}</Badge>} />;
                })}
              </List>
            )}
          </section>

          {data.tasks.length > 0 && (
            <section>
              <SectionHeader title="Offene Aufgaben" count={data.tasks.length} action={<SectionLink to="/aufgaben">Alle</SectionLink>} />
              <List>
                {data.tasks.map((t) => {
                  const late = !!t.dueAt && t.dueAt < now;
                  return (
                    <ListRow
                      key={t.id}
                      to={`/aufgaben?id=${t.id}`}
                      leading={<StatusDot tone={t.priority === 'high' ? 'bad' : t.priority === 'medium' ? 'warn' : 'muted'} />}
                      title={<span className="font-normal">{t.title}</span>}
                      trailing={<span className={clsx('text-meta tabular-nums', late ? 'font-medium text-bad' : 'text-ink-3')}>{fmtDate(t.dueAt)}</span>}
                    />
                  );
                })}
              </List>
            </section>
          )}

          {data.recent.length > 0 && (
            <Link to="/pruefungen?tab=done" className="group flex items-center gap-3 rounded-xl px-1 text-meta text-ink-2 hover:text-ink">
              <CalendarClock className="size-4 shrink-0 text-ink-3" />
              <span className="min-w-0 flex-1 truncate">
                Zuletzt geprüft: <b className="font-semibold text-ink">{data.recent[0].code}</b> {fmtRelative(data.recent[0].inspectedAt)}
              </span>
              <ArrowRight className="size-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
          )}
          {c.never > 0 && c.never === c.assets && <p className="px-1 text-meta text-ink-3">Noch kein Element geprüft – starte mit einem Rundgang.</p>}
        </div>
      </div>
    </div>
  );
}

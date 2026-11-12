// „Heute“: was jetzt zu tun ist – Vorschläge, Rundgänge, Zahlen und ein Knopf für alles andere.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, ArrowRight, Building2, CalendarClock, ChevronRight, CircleDashed, ClipboardCheck, Footprints, Mic, Plus, ScanLine, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, useDashboard, useMe } from '../api';
import { openCapture } from '../components/CaptureSheet';
import { Badge, Button, Card, Empty, ErrorBox, Spinner, toneDot, useToast } from '../components/ui';
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

function Counter({ to, tone, label, value }: { to: string; tone: Tone; label: string; value: number }) {
  return (
    <Link to={to} className="flex min-w-[8.5rem] shrink-0 flex-col gap-1 rounded-2xl bg-surface p-3.5 shadow-card transition hover:shadow-lift sm:min-w-0">
      <span className="flex items-center gap-1.5 text-[13px] text-ink-2">
        <span className={clsx('size-2 rounded-full', toneDot[tone])} />
        {label}
      </span>
      <span className="text-2xl font-semibold tracking-tight tabular-nums">{value}</span>
    </Link>
  );
}

function ActionTile({ onClick, to, icon, title, text, primary }: { onClick?: () => void; to?: string; icon: React.ReactNode; title: string; text: string; primary?: boolean }) {
  const cls = clsx(
    'group flex items-center gap-3 rounded-2xl p-4 text-left transition active:scale-[0.99] sm:flex-col sm:items-start sm:gap-6',
    primary ? 'bg-brand text-white shadow-lift hover:bg-brand-strong' : 'bg-surface shadow-card hover:shadow-lift',
  );
  const body = (
    <>
      <span className={clsx('grid size-11 shrink-0 place-items-center rounded-full [&>svg]:size-5', primary ? 'bg-white/20' : 'bg-sunken text-ink')}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className={clsx('block text-[13px]', primary ? 'text-white/80' : 'text-ink-3')}>{text}</span>
      </span>
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

function SuggestionCard({ s }: { s: Suggestion }) {
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
    <li className={clsx('animate-pop flex items-center gap-3 rounded-2xl p-3.5 pl-4', s.tone === 'bad' ? 'bg-bad-soft' : s.tone === 'warn' ? 'bg-warn-soft' : 'bg-info-soft')}>
      <div className="min-w-0 flex-1">
        <p className={clsx('text-sm font-semibold', s.tone === 'bad' ? 'text-bad' : s.tone === 'warn' ? 'text-warn' : 'text-info')}>{s.title}</p>
        <p className="text-[13px] text-ink-2">{s.text}</p>
      </div>
      {s.action ? (
        <Button size="sm" loading={busy} onClick={run}>
          {s.action.label}
        </Button>
      ) : s.link ? (
        <Button size="sm" variant="secondary" onClick={() => navigate(s.link!)} aria-label={`${s.title} öffnen`}>
          {s.kind === 'round' ? 'Starten' : 'Öffnen'}
        </Button>
      ) : null}
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
  const { data, isLoading, error } = useDashboard();
  const sugg = useSuggestions();
  const rounds = useRounds(30);
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  const c = data.counts;
  const firstName = me?.user.name.split(' ')[0];
  const canWrite = me?.user.role !== 'viewer';
  const topRound = rounds.data?.find((r) => r.overdue + r.due > 0);
  // Rundgänge stehen schon in eigener Liste – bei den Vorschlägen nur das Übrige
  const next = (sugg.data ?? []).filter((s) => s.kind !== 'round');
  const now = Date.now();
  const overdueTasks = data.tasks.filter((t) => t.dueAt && t.dueAt < now);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="text-sm text-ink-3">{fmtLong(now)}</p>
        <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">
          {greeting()}
          {firstName ? `, ${firstName}` : ''}
        </h1>
        <p className="mt-1 text-[15px] text-ink-2">
          {c.overdue + c.criticalDefects === 0
            ? 'Alles im grünen Bereich.'
            : [c.overdue && `${c.overdue} Prüfungen überfällig`, c.criticalDefects && `${c.criticalDefects} kritische Mängel`].filter(Boolean).join(' · ')}
        </p>
      </header>

      {canWrite && (
        <section className="grid gap-3 sm:grid-cols-3">
          <ActionTile primary onClick={() => openCapture()} icon={<Mic />} title="Erfassen" text="Mangel, Aufgabe oder Notiz einsprechen" />
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
            icon={<Building2 className="size-5" />}
            title="Lege dein erstes Objekt an"
            text="Objekte sind Liegenschaften, z. B. eine Schule oder ein Bürogebäude. Darin legst du Gebäude und die zu prüfenden Elemente an."
            action={
              <Link to="/objekte?neu=1">
                <Button icon={<Plus className="size-4" />}>Objekt anlegen</Button>
              </Link>
            }
          />
        </Card>
      ) : (
        <section>
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold">Prüfstatus</h2>
            <span className="text-[13px] text-ink-3">
              {c.assets} Elemente in {c.properties} Objekten
            </span>
          </div>
          <div className="-mx-4 flex gap-2.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-5 sm:overflow-visible sm:px-0">
            <Counter to="/pruefungen?tab=overdue" tone="bad" label="Überfällig" value={c.overdue} />
            <Counter to="/pruefungen?tab=soon" tone="warn" label="Bald fällig" value={c.soon} />
            <Counter to="/maengel" tone="brand" label="Offene Mängel" value={c.openDefects + c.openWalkDefects} />
            <Counter to="/pruefungen?tab=never" tone="info" label="Nie geprüft" value={c.never} />
            <Counter to="/pruefungen?tab=done" tone="ok" label="Geprüft (30 T.)" value={c.inspections30d} />
          </div>
        </section>
      )}

      {next.length > 0 && (
        <section>
          <h2 className="mb-3 flex items-center gap-1.5 text-[15px] font-semibold">
            <Sparkles className="size-4 text-brand" /> Als Nächstes
          </h2>
          <ul className="flex flex-col gap-2">
            {next.map((s) => (
              <SuggestionCard key={s.id} s={s} />
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.3fr_1fr]">
        <section className="min-w-0">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-[15px] font-semibold">Rundgänge</h2>
            <span className="text-[13px] text-ink-3">fällig in 30 Tagen, nach Gebäude</span>
          </div>
          {rounds.data && rounds.data.length === 0 ? (
            <Card>
              <Empty icon={<ClipboardCheck className="size-5" />} title="Nichts fällig" text="In den nächsten 30 Tagen steht keine Prüfung an." />
            </Card>
          ) : (
            <Card className="divide-y divide-line overflow-hidden">
              {(rounds.data ?? []).slice(0, 6).map((r) => (
                <Link key={r.buildingId} to={`/rundgang/${r.buildingId}`} className={clsx('flex items-center gap-3 px-4 py-3.5 hover:bg-sunken/60', r.overdue > 0 && 'bg-bad-soft/40')}>
                  <span className={clsx('grid size-10 shrink-0 place-items-center rounded-xl text-sm font-semibold tabular-nums', r.overdue ? 'bg-bad text-white' : 'bg-sunken')}>
                    {r.assets.length}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.buildingName}</span>
                    <span className={clsx('block truncate text-xs', r.overdue ? 'text-bad' : 'text-ink-3')}>
                      {r.overdue && r.earliest ? `Überfällig seit ${fmtRelative(r.earliest).replace(/^vor /, '')} · ` : r.earliest ? `ab ${fmtDate(r.earliest)} · ` : ''}
                      {r.propertyName}
                    </span>
                  </span>
                  <ChevronRight className="size-4 text-ink-3" />
                </Link>
              ))}
            </Card>
          )}
        </section>

        <div className="flex min-w-0 flex-col gap-6">
          <section>
            <div className="mb-3 flex items-baseline justify-between">
              <h2 className="text-[15px] font-semibold">Objekte</h2>
              <Link to="/objekte" className="text-[13px] font-medium text-ink-2 hover:text-ink">
                Alle
              </Link>
            </div>
            <Card className="divide-y divide-line overflow-hidden">
              {data.properties.slice(0, 6).map((p) => {
                const s = propertyTone(p);
                return (
                  <Link key={p.id} to={`/objekte/${p.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/60">
                    <span className={clsx('size-2 shrink-0 rounded-full', toneDot[s.tone])} />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">{p.name}</span>
                    <Badge tone={s.tone}>{s.label}</Badge>
                  </Link>
                );
              })}
              {data.properties.length === 0 && <Empty icon={<Building2 className="size-5" />} title="Noch keine Objekte" />}
            </Card>
          </section>

          {data.tasks.length > 0 && (
            <section>
              <div className="mb-3 flex items-baseline justify-between">
                <h2 className="text-[15px] font-semibold">Offene Aufgaben</h2>
                <Link to="/aufgaben" className="text-[13px] font-medium text-ink-2 hover:text-ink">
                  Alle
                </Link>
              </div>
              <Card className="divide-y divide-line overflow-hidden">
                {data.tasks.map((t) => (
                  <Link key={t.id} to={`/aufgaben?id=${t.id}`} className={clsx('flex items-center gap-3 px-4 py-3 hover:bg-sunken/60', overdueTasks.includes(t) && 'bg-bad-soft/40')}>
                    <span className={clsx('size-2 rounded-full', t.priority === 'high' ? 'bg-bad' : t.priority === 'medium' ? 'bg-warn' : 'bg-ink-3')} />
                    <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                    <span className={clsx('text-xs', t.dueAt && t.dueAt < now ? 'font-medium text-bad' : 'text-ink-3')}>{fmtDate(t.dueAt)}</span>
                  </Link>
                ))}
              </Card>
            </section>
          )}

          {data.recent.length > 0 && (
            <Link to="/pruefungen?tab=done" className="flex items-center justify-between rounded-2xl bg-surface px-4 py-3 text-sm shadow-card hover:shadow-lift">
              <span className="flex items-center gap-2">
                <CalendarClock className="size-4 text-ink-3" /> Zuletzt geprüft: <b>{data.recent[0].code}</b> {fmtRelative(data.recent[0].inspectedAt)}
              </span>
              <ArrowRight className="size-4 text-ink-3" />
            </Link>
          )}
          {c.never > 0 && c.never === c.assets && (
            <p className="flex items-center gap-2 text-xs text-ink-3">
              <CircleDashed className="size-3.5" /> Noch kein Element geprüft – starte mit einem Rundgang.
            </p>
          )}
          {c.criticalDefects > 0 && (
            <Link to="/maengel" className="flex items-center gap-2 text-sm font-medium text-bad">
              <AlertTriangle className="size-4" /> {c.criticalDefects} kritische Mängel ansehen
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}

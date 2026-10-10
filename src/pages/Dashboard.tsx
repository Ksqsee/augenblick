import clsx from 'clsx';
import { AlertTriangle, ArrowRight, Building2, CalendarClock, CircleDashed, ClipboardCheck, Footprints, ListTodo, Plus, ScanLine } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDashboard, useMe } from '../api';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Spinner, toneDot } from '../components/ui';
import { categoryLabel, defectsLabel, fmtDate, fmtLong, fmtRelative, greeting, RESULT_META, type Tone } from '../format';

function Stage({ to, tone, label, value, sub, icon }: { to: string; tone: Tone; label: string; value: number; sub: string; icon: ReactNode }) {
  return (
    <Link to={to} className="group relative flex flex-col overflow-hidden rounded-xl border border-line bg-surface p-4 shadow-card transition hover:border-line-strong">
      <span className={clsx('absolute inset-x-0 top-0 h-1', toneDot[tone])} />
      <span className="flex items-center gap-2 text-[13px] font-medium text-ink-2 [&>svg]:size-4 [&>svg]:text-ink-3">
        {icon}
        {label}
      </span>
      <span className="mt-3 text-3xl font-semibold tracking-tight tabular-nums">{value}</span>
      <span className="mt-1 flex items-center justify-between text-xs text-ink-3">
        {sub}
        <ArrowRight className="size-3.5 opacity-0 transition group-hover:opacity-100" />
      </span>
    </Link>
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
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  const c = data.counts;
  const firstName = me?.user.name.split(' ')[0];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-ink-3">{fmtLong(Date.now())}</p>
          <h1 className="mt-1 text-[28px] font-semibold tracking-tight">
            {greeting()}
            {firstName ? `, ${firstName}` : ''}
          </h1>
        </div>
        <div className="flex gap-2">
          <Link to="/elemente?neu=1">
            <Button variant="secondary" icon={<Plus className="size-4" />}>
              Element
            </Button>
          </Link>
          <Link to="/scan">
            <Button icon={<ScanLine className="size-4" />}>Prüfung starten</Button>
          </Link>
        </div>
      </div>

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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stage to="/pruefungen?tab=overdue" tone="bad" label="Überfällig" value={c.overdue} sub="sofort prüfen" icon={<CalendarClock />} />
            <Stage to="/pruefungen?tab=soon" tone="warn" label="Bald fällig" value={c.soon} sub="in 30 Tagen" icon={<CalendarClock />} />
            <Stage
              to="/maengel"
              tone="brand"
              label="Offene Mängel"
              value={c.openDefects + c.openWalkDefects}
              sub={c.criticalDefects ? `${c.criticalDefects} kritisch` : c.openWalkDefects ? `${c.openWalkDefects} aus Begehungen` : 'keine kritischen'}
              icon={<AlertTriangle />}
            />
            <Stage to="/pruefungen?tab=never" tone="info" label="Nie geprüft" value={c.never} sub="Erstprüfung offen" icon={<CircleDashed />} />
            <Stage to="/pruefungen?tab=done" tone="ok" label="Geprüft" value={c.inspections30d} sub="letzte 30 Tage" icon={<ClipboardCheck />} />
            <Stage to="/begehungen" tone="muted" label="Begehungen" value={c.walkDue} sub="fällig in 30 Tagen" icon={<Footprints />} />
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardHeader
            title="Objekte"
            subtitle="Status je Liegenschaft"
            action={
              <Link to="/objekte" className="text-[13px] font-medium text-ink-2 hover:text-ink">
                Alle
              </Link>
            }
          />
          {data.properties.length === 0 ? (
            <Empty icon={<Building2 className="size-5" />} title="Noch keine Objekte" />
          ) : (
            <ul className="divide-y divide-line">
              {data.properties.slice(0, 8).map((p) => {
                const s = propertyTone(p);
                return (
                  <li key={p.id}>
                    <Link to={`/objekte/${p.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-sunken/60">
                      <span className={clsx('size-2 shrink-0 rounded-full', toneDot[s.tone])} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{p.name}</span>
                        <span className="block truncate text-xs text-ink-3">{p.address.split('\n')[0] || '–'}</span>
                      </span>
                      <Badge tone={s.tone}>{s.label}</Badge>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader title="Zuletzt geprüft" />
            {data.recent.length === 0 ? (
              <Empty icon={<ClipboardCheck className="size-5" />} title="Noch keine Prüfungen" />
            ) : (
              <ul className="divide-y divide-line">
                {data.recent.map((r) => (
                  <li key={r.id}>
                    <Link to={`/druck/protokoll/${r.id}`} className="flex items-center gap-3 px-5 py-3 hover:bg-sunken/60">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium">
                          {r.code} <span className="font-normal text-ink-3">· {categoryLabel(r.category)}</span>
                        </span>
                        <span className="block truncate text-xs text-ink-3">
                          {r.location || '–'} · {r.inspector}
                        </span>
                      </span>
                      <span className="flex flex-col items-end gap-1">
                        <Badge tone={RESULT_META[r.result].tone}>{RESULT_META[r.result].label}</Badge>
                        <span className="text-[11px] text-ink-3">{fmtRelative(r.inspectedAt)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Offene Aufgaben"
              action={
                <Link to="/aufgaben" className="text-[13px] font-medium text-ink-2 hover:text-ink">
                  Alle
                </Link>
              }
            />
            {data.tasks.length === 0 ? (
              <Empty icon={<ListTodo className="size-5" />} title="Keine offenen Aufgaben" />
            ) : (
              <ul className="divide-y divide-line">
                {data.tasks.map((t) => (
                  <li key={t.id} className="flex items-center gap-3 px-5 py-3">
                    <span className={clsx('size-2 rounded-full', t.priority === 'high' ? 'bg-bad' : t.priority === 'medium' ? 'bg-warn' : 'bg-ink-3')} />
                    <span className="min-w-0 flex-1 truncate text-sm">{t.title}</span>
                    <span className={clsx('text-xs', t.dueAt && t.dueAt < Date.now() ? 'font-medium text-bad' : 'text-ink-3')}>{fmtDate(t.dueAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

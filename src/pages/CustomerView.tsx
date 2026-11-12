// Kunden-Ansicht (öffentlicher Link je Objekt): Prüfstatus auf einen Blick, nur lesend.
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { AlertTriangle, Building2, CalendarClock, CheckCircle2, CircleDashed, Mail, Phone, Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import type { Category, Severity } from '../../shared/catalog';
import { SEVERITIES } from '../../shared/catalog';
import type { Result } from '../../shared/logic';
import { api } from '../api';
import { CategoryIcon } from '../components/CategoryIcon';
import { Badge, ErrorBox, Spinner } from '../components/ui';
import { categoryLabel, fmtDate, fmtLong, RESULT_META } from '../format';

interface ShareData {
  property: { name: string; address: string };
  provider: { name: string; phone: string; email: string; hasLogo: boolean };
  counts: { assets: number; overdue: number; never: number; soon: number };
  assets: { code: string; category: Category; location: string; floor: string; nextDueAt: number | null; lastInspectedAt: number | null; buildingName: string; lastResult: Result | null; openDefects: number }[];
  defects: { title: string; severity: Severity; measure: string; createdAt: number; code: string | null }[] | null;
  recent: { code: string; category: Category; inspectedAt: number; result: Result }[];
  generatedAt: number;
}

const SEV_DOT: Record<Severity, string> = { low: 'bg-ink-3', medium: 'bg-warn', high: 'bg-brand', critical: 'bg-bad' };

function dueBadge(a: ShareData['assets'][number], now: number) {
  if (a.nextDueAt == null) return <Badge tone="info">Noch nicht geprüft</Badge>;
  if (a.nextDueAt < now) return <Badge tone="bad">Überfällig seit {fmtDate(a.nextDueAt)}</Badge>;
  if (a.nextDueAt < now + 30 * 86_400_000) return <Badge tone="warn">Fällig {fmtDate(a.nextDueAt)}</Badge>;
  return <Badge tone="ok">Nächste Prüfung {fmtDate(a.nextDueAt)}</Badge>;
}

export function CustomerView() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['share', token], queryFn: () => api<ShareData>(`/public/property/${token}`), retry: false });
  if (q.isLoading) return <Spinner className="min-h-dvh items-center" />;
  if (q.error || !q.data)
    return (
      <div className="mx-auto max-w-md px-4 py-16">
        <ErrorBox error={new Error('Dieser Link ist ungültig, abgelaufen oder wurde zurückgezogen. Bitte beim Prüfdienstleister einen neuen anfordern.')} />
      </div>
    );
  const d = q.data;
  const c = d.counts;
  const okCount = c.assets - c.overdue - c.never;
  const pct = c.assets ? Math.round((okCount / c.assets) * 100) : 100;
  const buildings = [...new Set(d.assets.map((a) => a.buildingName))];
  const now = d.generatedAt;

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-3 sm:px-6">
          {d.provider.hasLogo ? (
            <img src={`/api/public/property/${token}/logo`} alt="" className="h-8 max-w-32 object-contain" />
          ) : (
            <span className="grid size-8 place-items-center rounded-lg bg-ink text-sm font-semibold text-white">{d.provider.name.slice(0, 1)}</span>
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{d.provider.name}</span>
          <button onClick={() => window.print()} className="no-print inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-[13px] font-medium text-ink-2 hover:bg-sunken">
            <Printer className="size-4" /> Drucken
          </button>
        </div>
      </header>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6">
        <div>
          <p className="text-sm text-ink-3">Brandschutz-Status · Stand {fmtLong(now)}</p>
          <h1 className="mt-1 text-[28px] leading-tight font-semibold tracking-tight">{d.property.name}</h1>
          {d.property.address && <p className="mt-1 text-[15px] whitespace-pre-line text-ink-2">{d.property.address}</p>}
        </div>

        <section className="rounded-2xl bg-surface p-5 shadow-card sm:p-6">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <p className="text-[13px] font-medium text-ink-2">Fristgerecht geprüft</p>
              <p className="text-4xl font-semibold tracking-tight tabular-nums">{pct} %</p>
            </div>
            <p className="text-[13px] text-ink-3">
              {okCount} von {c.assets} Elementen
            </p>
          </div>
          <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Prüfquote">
            <div className={clsx('h-full rounded-full', pct >= 95 ? 'bg-ok' : pct >= 80 ? 'bg-warn' : 'bg-bad')} style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              { icon: <CalendarClock />, label: 'Überfällig', value: c.overdue, tone: c.overdue ? 'text-bad' : 'text-ok' },
              { icon: <CircleDashed />, label: 'Noch nicht geprüft', value: c.never, tone: c.never ? 'text-info' : 'text-ok' },
              ...(d.defects ? [{ icon: <AlertTriangle />, label: 'Offene Mängel', value: d.defects.length, tone: d.defects.length ? 'text-warn' : 'text-ok' }] : [{ icon: <CalendarClock />, label: 'Fällig in 30 Tagen', value: c.soon, tone: 'text-ink' }]),
            ].map((s) => (
              <div key={s.label} className="flex items-center gap-3 rounded-xl bg-sunken/60 px-4 py-3">
                <span className={clsx('[&>svg]:size-5', s.tone)}>{s.icon}</span>
                <span className="flex-1 text-sm text-ink-2">{s.label}</span>
                <span className={clsx('text-xl font-semibold tabular-nums', s.tone)}>{s.value}</span>
              </div>
            ))}
          </div>
        </section>

        {d.defects && (
          <section>
            <h2 className="mb-3 text-[15px] font-semibold">Offene Mängel</h2>
            {d.defects.length === 0 ? (
              <p className="flex items-center gap-2 rounded-2xl bg-surface p-4 text-sm shadow-card">
                <CheckCircle2 className="size-5 text-ok" /> Keine offenen Mängel.
              </p>
            ) : (
              <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface shadow-card">
                {d.defects.map((x, i) => (
                  <li key={i} className="flex gap-3 px-4 py-3">
                    <span className={clsx('mt-1.5 size-2.5 shrink-0 rounded-full', SEV_DOT[x.severity])} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{x.title}</p>
                      <p className="text-xs text-ink-3">
                        {SEVERITIES[x.severity]}
                        {x.code && ` · ${x.code}`} · festgestellt {fmtDate(x.createdAt)}
                        {x.measure && ` · Maßnahme: ${x.measure}`}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        <section>
          <h2 className="mb-3 text-[15px] font-semibold">Elemente</h2>
          <div className="flex flex-col gap-4">
            {buildings.map((b) => (
              <div key={b} className="overflow-hidden rounded-2xl bg-surface shadow-card">
                <p className="flex items-center gap-2 border-b border-line px-4 py-2.5 text-[13px] font-semibold text-ink-2">
                  <Building2 className="size-4 text-ink-3" /> {b}
                </p>
                <ul className="divide-y divide-line">
                  {d.assets
                    .filter((a) => a.buildingName === b)
                    .map((a) => (
                      <li key={a.code} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                        <div className="flex min-w-0 flex-1 items-center gap-3">
                          <CategoryIcon category={a.category} size="sm" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium">
                              {a.code} <span className="font-normal text-ink-3">· {categoryLabel(a.category)}</span>
                            </p>
                            <p className="truncate text-xs text-ink-3">
                              {[a.floor, a.location].filter(Boolean).join(', ') || '–'}
                              {a.lastInspectedAt ? ` · zuletzt geprüft ${fmtDate(a.lastInspectedAt)}` : ''}
                            </p>
                          </div>
                        </div>
                        <div className="ml-11 flex flex-wrap gap-1.5 sm:ml-0">
                          {a.lastResult && <Badge tone={RESULT_META[a.lastResult].tone}>{RESULT_META[a.lastResult].label}</Badge>}
                          {dueBadge(a, now)}
                        </div>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {d.recent.length > 0 && (
          <section>
            <h2 className="mb-3 text-[15px] font-semibold">Letzte Prüfungen</h2>
            <ul className="divide-y divide-line overflow-hidden rounded-2xl bg-surface shadow-card">
              {d.recent.map((r, i) => (
                <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                  <span className="w-24 shrink-0 text-ink-3 tabular-nums">{fmtDate(r.inspectedAt)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {r.code} <span className="text-ink-3">· {categoryLabel(r.category)}</span>
                  </span>
                  <Badge tone={RESULT_META[r.result].tone}>{RESULT_META[r.result].label}</Badge>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="flex flex-col gap-2 border-t border-line pt-6 text-[13px] text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <span>Freigegeben von {d.provider.name} · nur lesend</span>
          <span className="flex flex-wrap gap-4">
            {d.provider.phone && (
              <a href={`tel:${d.provider.phone}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                <Phone className="size-3.5" /> {d.provider.phone}
              </a>
            )}
            {d.provider.email && (
              <a href={`mailto:${d.provider.email}`} className="inline-flex items-center gap-1.5 hover:text-ink">
                <Mail className="size-3.5" /> {d.provider.email}
              </a>
            )}
          </span>
        </footer>
      </main>
    </div>
  );
}

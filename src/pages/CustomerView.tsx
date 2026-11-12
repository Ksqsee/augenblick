// Kunden-Ansicht (öffentlicher Link je Objekt): Prüfstatus auf einen Blick, nur lesend.
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Link2Off, Mail, Phone, Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import type { Category, Severity } from '../../shared/catalog';
import type { Result } from '../../shared/logic';
import { api } from '../api';
import { MeterBar, PublicHeader } from '../components/admin';
import { CategoryIcon } from '../components/CategoryIcon';
import { Badge, Card, Empty, ListGroup, SeverityBadge, Skeleton, StatusDot } from '../components/ui';
import { categoryLabel, fmtDate, fmtLong, RESULT_META, type Tone } from '../format';

interface ShareData {
  property: { name: string; address: string };
  provider: { name: string; phone: string; email: string; hasLogo: boolean };
  counts: { assets: number; overdue: number; never: number; soon: number };
  assets: { code: string; category: Category; location: string; floor: string; nextDueAt: number | null; lastInspectedAt: number | null; buildingName: string; lastResult: Result | null; openDefects: number }[];
  defects: { title: string; severity: Severity; measure: string; createdAt: number; code: string | null }[] | null;
  recent: { code: string; category: Category; inspectedAt: number; result: Result }[];
  generatedAt: number;
}

function dueBadge(a: ShareData['assets'][number], now: number) {
  const [tone, text]: [Tone, string] =
    a.nextDueAt == null
      ? ['info', 'Noch nicht geprüft']
      : a.nextDueAt < now
        ? ['bad', `Überfällig seit ${fmtDate(a.nextDueAt)}`]
        : a.nextDueAt < now + 30 * 86_400_000
          ? ['warn', `Fällig ${fmtDate(a.nextDueAt)}`]
          : ['ok', `Nächste Prüfung ${fmtDate(a.nextDueAt)}`];
  return (
    <Badge tone={tone} dot>
      {text}
    </Badge>
  );
}

function Count({ n }: { n: number }) {
  return <span className="rounded-md bg-sunken px-1.5 text-caption font-medium text-ink-2 tabular-nums">{n}</span>;
}

export function CustomerView() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['share', token], queryFn: () => api<ShareData>(`/public/property/${token}`), retry: false });
  if (q.isLoading)
    return (
      <div className="min-h-dvh bg-canvas">
        <div className="mx-auto flex max-w-4xl flex-col gap-4 px-4 py-20 sm:px-6" role="status" aria-label="Lädt">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-8 w-72" />
          <Skeleton className="mt-4 h-48 w-full rounded-xl" />
        </div>
      </div>
    );
  if (q.error || !q.data)
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas px-4">
        <Card className="w-full max-w-md">
          <Empty icon={<Link2Off />} title="Link nicht mehr gültig" text="Dieser Link ist ungültig, abgelaufen oder wurde zurückgezogen. Bitte beim Prüfdienstleister einen neuen anfordern." />
        </Card>
      </div>
    );
  const d = q.data;
  const c = d.counts;
  const okCount = c.assets - c.overdue - c.never;
  const pct = c.assets ? Math.round((okCount / c.assets) * 100) : 100;
  const share = (v: number) => (c.assets ? (v / c.assets) * 100 : 0);
  const buildings = [...new Set(d.assets.map((a) => a.buildingName))];
  const now = d.generatedAt;
  const overall: { tone: Tone; text: string } =
    c.overdue > 0
      ? { tone: 'bad', text: `${c.overdue} ${c.overdue === 1 ? 'Prüfung ist' : 'Prüfungen sind'} überfällig` }
      : c.never > 0
        ? { tone: 'info', text: `${c.never} ${c.never === 1 ? 'Element wurde' : 'Elemente wurden'} noch nicht geprüft` }
        : { tone: 'ok', text: 'Alle Prüfungen sind fristgerecht' };
  const stats: { label: string; value: number; tone: Tone }[] = [
    { label: 'Überfällig', value: c.overdue, tone: 'bad' },
    { label: 'Noch nicht geprüft', value: c.never, tone: 'info' },
    d.defects ? { label: 'Offene Mängel', value: d.defects.length, tone: 'warn' } : { label: 'Fällig in 30 Tagen', value: c.soon, tone: 'warn' },
  ];

  return (
    <div className="min-h-dvh bg-canvas">
      <PublicHeader
        actions={
          <button type="button" onClick={() => window.print()} className="no-print inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-meta font-medium text-ink-2 hover:bg-sunken hover:text-ink">
            <Printer className="size-4" /> Drucken
          </button>
        }
      >
        {d.provider.hasLogo ? (
          <img src={`/api/public/property/${token}/logo`} alt="" className="h-8 max-w-32 object-contain" />
        ) : (
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink text-meta font-semibold text-white">{d.provider.name.slice(0, 1)}</span>
        )}
        <span className="min-w-0 truncate text-body font-medium">{d.provider.name}</span>
      </PublicHeader>

      <main className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-8 sm:px-6 sm:py-10">
        <div>
          <p className="text-meta text-ink-3">Brandschutz-Status · Stand {fmtLong(now)}</p>
          <h1 className="mt-1 text-h1 font-semibold tracking-[-0.02em] sm:text-display">{d.property.name}</h1>
          {d.property.address && <p className="mt-1 text-body whitespace-pre-line text-ink-2">{d.property.address}</p>}
        </div>

        <Card className="overflow-hidden">
          <div className="flex flex-col gap-4 p-5 sm:p-6">
            <p className="flex items-center gap-2 text-body font-medium">
              <StatusDot tone={overall.tone} />
              {overall.text}
            </p>
            <div className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <p className="text-meta text-ink-2">Fristgerecht geprüft</p>
                <p className="text-[40px] leading-[44px] font-semibold tracking-[-0.02em] tabular-nums">{pct} %</p>
              </div>
              <p className="text-meta text-ink-3 tabular-nums">
                {okCount} von {c.assets} Elementen
              </p>
            </div>
            <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Prüfquote">
              <MeterBar
                label="Verteilung nach Status"
                className="h-2.5"
                parts={[
                  { key: 'ok', value: c.assets ? share(okCount) : 100, className: 'bg-ok' },
                  { key: 'never', value: share(c.never), className: 'bg-info' },
                  { key: 'overdue', value: share(c.overdue), className: 'bg-bad' },
                ]}
              />
            </div>
          </div>
          <dl className="grid grid-cols-1 divide-y divide-line border-t border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {stats.map((s) => (
              <div key={s.label} className="flex items-center justify-between gap-3 px-5 py-3 sm:flex-col sm:items-start sm:gap-1 sm:px-6 sm:py-4">
                <dt className="flex items-center gap-2 text-meta text-ink-2">
                  <StatusDot tone={s.value ? s.tone : 'muted'} />
                  {s.label}
                </dt>
                <dd className={`text-[22px] leading-7 font-semibold tabular-nums ${s.value ? 'text-ink' : 'text-ink-4'}`}>{s.value}</dd>
              </div>
            ))}
          </dl>
        </Card>

        {d.defects && (
          <section>
            <h2 className="mb-2.5 flex items-center gap-2 text-title font-semibold">
              Offene Mängel <Count n={d.defects.length} />
            </h2>
            {d.defects.length === 0 ? (
              <Card className="flex items-center gap-3 p-4">
                <CheckCircle2 className="size-5 text-ok" />
                <p className="text-body">Keine offenen Mängel.</p>
              </Card>
            ) : (
              <Card className="overflow-hidden">
                <ul className="divide-y divide-line">
                  {d.defects.map((x, i) => (
                    <li key={i} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <p className="text-body font-medium">{x.title}</p>
                        <p className="mt-0.5 text-meta text-ink-3">
                          {x.code && `${x.code} · `}festgestellt {fmtDate(x.createdAt)}
                          {x.measure && ` · Maßnahme: ${x.measure}`}
                        </p>
                      </div>
                      <SeverityBadge severity={x.severity} className="self-start sm:self-auto" />
                    </li>
                  ))}
                </ul>
              </Card>
            )}
          </section>
        )}

        <section>
          <h2 className="mb-2.5 flex items-center gap-2 text-title font-semibold">
            Elemente <Count n={d.assets.length} />
          </h2>
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              {buildings.flatMap((b) => {
                const list = d.assets.filter((a) => a.buildingName === b);
                return [
                  <ListGroup key={`g-${b}`} title={b} count={list.length} />,
                  ...list.map((a) => (
                    <li key={a.code} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <CategoryIcon category={a.category} size="sm" />
                        <div className="min-w-0">
                          <p className="truncate text-body font-medium">
                            {a.code} <span className="font-normal text-ink-3">· {categoryLabel(a.category)}</span>
                          </p>
                          <p className="truncate text-meta text-ink-3">
                            {[a.floor, a.location].filter(Boolean).join(', ') || '–'}
                            {a.lastInspectedAt ? ` · zuletzt geprüft ${fmtDate(a.lastInspectedAt)}` : ''}
                          </p>
                        </div>
                      </div>
                      <div className="ml-11 flex flex-wrap gap-1.5 sm:ml-0 sm:justify-end">
                        {a.lastResult && (
                          <Badge tone={RESULT_META[a.lastResult].tone} variant="outline">
                            {RESULT_META[a.lastResult].label}
                          </Badge>
                        )}
                        {dueBadge(a, now)}
                      </div>
                    </li>
                  )),
                ];
              })}
            </ul>
          </Card>
        </section>

        {d.recent.length > 0 && (
          <section>
            <h2 className="mb-2.5 text-title font-semibold">Letzte Prüfungen</h2>
            <Card className="overflow-hidden">
              <ul className="divide-y divide-line">
                {d.recent.map((r, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-2.5 text-body">
                    <span className="w-24 shrink-0 text-meta text-ink-3 tabular-nums">{fmtDate(r.inspectedAt)}</span>
                    <span className="min-w-0 flex-1 truncate">
                      {r.code} <span className="text-ink-3">· {categoryLabel(r.category)}</span>
                    </span>
                    <Badge tone={RESULT_META[r.result].tone} dot>
                      {RESULT_META[r.result].label}
                    </Badge>
                  </li>
                ))}
              </ul>
            </Card>
          </section>
        )}

        <footer className="flex flex-col gap-3 border-t border-line pt-6 text-meta text-ink-3 sm:flex-row sm:items-center sm:justify-between">
          <span>Freigegeben von {d.provider.name} · nur lesend</span>
          <span className="flex flex-wrap gap-4">
            {d.provider.phone && (
              <a href={`tel:${d.provider.phone}`} className="inline-flex min-h-8 items-center gap-1.5 hover:text-ink">
                <Phone className="size-3.5" /> {d.provider.phone}
              </a>
            )}
            {d.provider.email && (
              <a href={`mailto:${d.provider.email}`} className="inline-flex min-h-8 items-center gap-1.5 hover:text-ink">
                <Mail className="size-3.5" /> {d.provider.email}
              </a>
            )}
          </span>
        </footer>
      </main>
    </div>
  );
}

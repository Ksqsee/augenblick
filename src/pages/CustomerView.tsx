// Kunden-Ansicht (öffentlicher Link je Objekt): Prüfstatus auf einen Blick, nur lesend.
// v3: im Stil der Anmeldung – Beton-Grund, Logo des Prüfdienstleisters oben links, eine weiße Fläche mit Abschnitten.
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Printer } from 'lucide-react';
import { useParams } from 'react-router-dom';
import type { Category, Severity } from '../../shared/catalog';
import type { Result } from '../../shared/logic';
import { api } from '../api';
import { MeterBar, PublicPage, SurfaceHead } from '../components/admin';
import { Section, SeverityBadge, Skeleton, StatTile, StatusText, Surface } from '../components/ui';
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

/** Ein Statuswort je Element: Fälligkeit. Das letzte Ergebnis steht in der Meta-Zeile. */
function dueStatus(a: ShareData['assets'][number], now: number) {
  const [tone, text]: [Tone, string] =
    a.nextDueAt == null
      ? ['info', 'nie geprüft']
      : a.nextDueAt < now
        ? ['bad', `überfällig seit ${fmtDate(a.nextDueAt)}`]
        : a.nextDueAt < now + 30 * 86_400_000
          ? ['warn', `fällig ${fmtDate(a.nextDueAt)}`]
          : ['ok', `nächste ${fmtDate(a.nextDueAt)}`];
  return (
    <StatusText tone={tone} className="shrink-0 tabular-nums">
      {text}
    </StatusText>
  );
}

export function CustomerView() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['share', token], queryFn: () => api<ShareData>(`/public/property/${token}`), retry: false });
  if (q.isLoading)
    return (
      <PublicPage width="wide">
        <Surface className="flex flex-col gap-3 p-(--row-px) sm:p-8" role="status" aria-label="Lädt">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-8 w-72 max-w-full" />
          <Skeleton className="mt-4 h-40 w-full" />
        </Surface>
      </PublicPage>
    );
  if (q.error || !q.data)
    return (
      <PublicPage>
        <Surface className="max-w-[400px] px-5 py-7 sm:px-8 sm:py-9">
          <h1 className="text-h1 font-semibold tracking-[-0.02em]">Link nicht mehr gültig</h1>
          <p className="mt-1.5 text-body text-ink-2">Dieser Link ist ungültig, abgelaufen oder wurde zurückgezogen. Bitte beim Prüfdienstleister einen neuen anfordern.</p>
        </Surface>
      </PublicPage>
    );
  const d = q.data;
  const c = d.counts;
  const okCount = c.assets - c.overdue - c.never;
  const pct = c.assets ? Math.round((okCount / c.assets) * 100) : 100;
  const share = (v: number) => (c.assets ? (v / c.assets) * 100 : 0);
  const buildings = [...new Set(d.assets.map((a) => a.buildingName))];
  const now = d.generatedAt;
  // Lage als Satz: Zahl zuerst, nur „überfällig“ in Zinnober
  const overall =
    c.overdue > 0 ? (
      <>
        {c.overdue} {c.overdue === 1 ? 'Prüfung ist' : 'Prüfungen sind'} <span className="text-shu">überfällig</span>.
      </>
    ) : c.never > 0 ? (
      <>
        {c.never} {c.never === 1 ? 'Element wurde' : 'Elemente wurden'} noch nicht geprüft.
      </>
    ) : (
      'Alle Prüfungen sind fristgerecht.'
    );
  const stats: { label: string; value: number; tone: Tone }[] = [
    { label: 'Überfällig', value: c.overdue, tone: 'bad' },
    { label: 'Noch nicht geprüft', value: c.never, tone: 'info' },
    d.defects ? { label: 'Offene Mängel', value: d.defects.length, tone: 'warn' } : { label: 'Fällig in 30 Tagen', value: c.soon, tone: 'warn' },
  ];

  return (
    <PublicPage
      width="wide"
      brand={
        <span className="flex min-w-0 items-center gap-2.5">
          {d.provider.hasLogo ? (
            <img src={`/api/public/property/${token}/logo`} alt="" className="h-7 max-w-28 object-contain" />
          ) : (
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-ink text-meta font-semibold text-white">{d.provider.name.slice(0, 1)}</span>
          )}
          <span className="min-w-0 truncate text-[15px] font-semibold tracking-[-0.01em]">{d.provider.name}</span>
        </span>
      }
      actions={
        <button type="button" onClick={() => window.print()} className="inline-flex h-9 items-center gap-1.5 rounded-md px-2.5 text-meta font-medium text-ink-2 hover:bg-sunken hover:text-ink">
          <Printer className="size-4" /> Drucken
        </button>
      }
      footer={
        <span className="flex flex-wrap gap-x-4 gap-y-1">
          <span>Freigegeben von {d.provider.name} · nur lesend</span>
          {d.provider.phone && (
            <a href={`tel:${d.provider.phone}`} className="hover:text-ink">
              {d.provider.phone}
            </a>
          )}
          {d.provider.email && (
            <a href={`mailto:${d.provider.email}`} className="hover:text-ink">
              {d.provider.email}
            </a>
          )}
        </span>
      }
    >
      <Surface>
        <SurfaceHead
          eyebrow={`Brandschutz-Status · Stand ${fmtLong(now)}`}
          title={d.property.name}
          meta={d.property.address ? <span className="whitespace-pre-line">{d.property.address}</span> : undefined}
          className="pb-2 sm:pb-2"
        />
        <div className="px-(--row-px) pb-6">
          <p className="text-h2 font-medium tracking-[-0.01em] text-ink">{overall}</p>
        </div>

        <Section title="Fristgerecht geprüft" action={<span className="text-meta text-ink-3 tabular-nums">{`${okCount} von ${c.assets} Elementen`}</span>}>
          <p className="text-[34px] leading-10 font-semibold tracking-[-0.02em] tabular-nums">{pct} %</p>
          <div role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Prüfquote" className="mt-3">
            <MeterBar
              label="Verteilung nach Status"
              className="h-1.5"
              parts={[
                { key: 'ok', value: c.assets ? share(okCount) : 100, className: 'bg-ink' },
                { key: 'never', value: share(c.never), className: 'bg-line-strong' },
                { key: 'overdue', value: share(c.overdue), className: 'bg-shu' },
              ]}
            />
          </div>
          <div className="mt-6 grid grid-cols-3">
            {stats.map((s, i) => (
              <StatTile key={s.label} tone={s.tone} label={s.label} value={s.value} divider={i > 0} className={clsx(i > 0 && 'sm:pl-6')} />
            ))}
          </div>
        </Section>

        {d.defects && (
          <Section title="Offene Mängel" count={d.defects.length} flush={d.defects.length > 0}>
            {d.defects.length === 0 ? (
              <p className="text-body text-ink-2">Keine offenen Mängel.</p>
            ) : (
              <ul className="pk-list" aria-label="Offene Mängel">
                {d.defects.map((x, i) => (
                  <li key={i} className="flex min-h-14 items-center gap-3 px-(--row-px) py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="text-body text-ink">{x.title}</p>
                      <p className="mt-0.5 text-meta text-ink-3">
                        {x.code && `${x.code} · `}festgestellt {fmtDate(x.createdAt)}
                        {x.measure && ` · Maßnahme: ${x.measure}`}
                      </p>
                    </div>
                    <SeverityBadge severity={x.severity} className="shrink-0" />
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        <Section title="Elemente" count={d.assets.length} flush>
          <ul className="pk-list" aria-label="Elemente">
            {buildings.flatMap((b) => {
              const list = d.assets.filter((a) => a.buildingName === b);
              return [
                <li key={`g-${b}`} className="flex h-9 items-end gap-2 px-(--row-px) pb-1.5 text-meta font-medium text-ink-3 [&+li]:before:hidden!">
                  {b} <span className="font-normal tabular-nums">{list.length}</span>
                </li>,
                ...list.map((a) => (
                  <li key={a.code} className="flex min-h-14 flex-col justify-center gap-1 px-(--row-px) py-2.5 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-body text-ink">
                        {a.code} <span className="text-ink-3">· {categoryLabel(a.category)}</span>
                      </p>
                      <p className="truncate text-meta text-ink-3">
                        {[a.floor, a.location].filter(Boolean).join(', ') || '–'}
                        {a.lastInspectedAt ? ` · geprüft ${fmtDate(a.lastInspectedAt)}` : ''}
                        {a.lastResult ? ` · ${RESULT_META[a.lastResult].label}` : ''}
                      </p>
                    </div>
                    {dueStatus(a, now)}
                  </li>
                )),
              ];
            })}
          </ul>
        </Section>

        {d.recent.length > 0 && (
          <Section title="Letzte Prüfungen" flush>
            <ul className="pk-list pb-1" aria-label="Letzte Prüfungen">
              {d.recent.map((r, i) => (
                <li key={i} className="flex min-h-11 items-center gap-3 px-(--row-px) py-2 text-body" style={{ '--row-inset': '108px' } as React.CSSProperties}>
                  <span className="w-24 shrink-0 text-meta text-ink-3 tabular-nums">{fmtDate(r.inspectedAt)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {r.code} <span className="text-ink-3">· {categoryLabel(r.category)}</span>
                  </span>
                  <StatusText tone={RESULT_META[r.result].tone} className="shrink-0">
                    {RESULT_META[r.result].label}
                  </StatusText>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </Surface>
    </PublicPage>
  );
}

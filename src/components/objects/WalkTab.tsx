// Reiter „Begehung“ des Objekts (Plan v8 Z). Oben der eine große Knopf „Begehung starten“ → „Tür ansagen“ für dieses
// Objekt (components/inspect/Announce.tsx mit festem Objekt); alternativ der Rundgang in Laufreihenfolge. Darunter die
// laufende bzw. letzte Begehung als Ergebnisliste – eine Begehung = alle Prüfungen des Objekts an einem Tag
// (GET /properties/:id/walk, Logik in shared/walk.ts) – mit Zählern als Filter und Auswahl früherer Tage. Daneben die
// Folgeschritte in fester Reihenfolge: Unterschreiben (n) → Sammelmappe → Angebotsliste. Brandschutzbegehungen
// (Protokoll nach DGUV, früher Reiter „Begehungen“) als eigener Abschnitt darunter. Daten erst, wenn der Reiter offen ist.
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { BookCopy, Footprints, Mic, PenLine, Plus, ReceiptText, Route } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { filterWalk, type WalkInspection, type WalkRow, type WalkStatus, walkResult } from '../../../shared/walk';
import { api, type Asset, type PropertyDetail } from '../../api';
import { categoryLabel, defectsLabel, fmtDate, fmtDateTime, type Tone } from '../../format';
import { StartWalkthrough } from '../../pages/Walkthroughs';
import { AnnounceCard } from '../inspect/Announce';
import { MappeDialog } from '../Mappe';
import { Button, Empty, ErrorBox, List, ListRow, ResultBadge, Section, Select, SkeletonList, StatusDot, StatusText, Surface, toneText } from '../ui';

export interface PropertyWalk {
  date: string;
  today: string;
  timeZone: string;
  from: number;
  to: number;
  days: { date: string; count: number }[];
  inspections: WalkInspection[];
  pending: number;
}

export const usePropertyWalk = (propertyId: string, date: string | null) =>
  useQuery({
    queryKey: ['walk', propertyId, date ?? ''],
    queryFn: () => api<PropertyWalk>(`/properties/${propertyId}/walk${date ? `?date=${date}` : ''}`),
  });

const STATUS: Record<WalkStatus, { label: string; filter: string; tone: Tone }> = {
  ok: { label: 'bestanden', filter: 'Bestanden', tone: 'ok' },
  defects: { label: 'mit Mangel', filter: 'Mit Mangel', tone: 'warn' },
  not_inspectable: { label: 'nicht prüfbar', filter: 'Nicht prüfbar', tone: 'muted' },
  open: { label: 'noch offen', filter: 'Noch offen', tone: 'muted' },
};
const FILTERS = ['all', 'ok', 'defects', 'not_inspectable', 'open'] as const;
type Filter = (typeof FILTERS)[number];

const n2 = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const dayLabel = (d: string, today: string) => {
  const [y, m, dd] = d.split('-').map(Number) as [number, number, number];
  const text = new Date(y, m - 1, dd).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  return d === today ? `Heute, ${text}` : text;
};

export function WalkTab({ p, canInspect }: { p: PropertyDetail; canInspect: boolean }) {
  const [params, setParams] = useSearchParams();
  const tag = params.get('tag');
  const walk = usePropertyWalk(p.id, tag);
  const set = (patch: Record<string, string | null>) =>
    setParams(
      (q) => {
        const n = new URLSearchParams(q);
        for (const [k, v] of Object.entries(patch)) v ? n.set(k, v) : n.delete(k);
        return n;
      },
      { replace: true },
    );
  const filter = (FILTERS as readonly string[]).includes(params.get('zeige') ?? '') ? (params.get('zeige') as Filter) : 'all';
  const [walkStart, setWalkStart] = useState(false);
  const w = walk.data;
  // Begehung läuft: heute schon etwas geprüft, gerade gestartet oder von „Bereit · nächste Tür“ zurück
  const running = params.get('ansage') === 'weiter' || params.get('start') === '1' || (!!w && w.days[0]?.date === w.today && !tag);

  return (
    <>
      {walkStart && <StartWalkthrough propertyId={p.id} onClose={() => setWalkStart(false)} />}
      <Surface data-detail-surface>
        {canInspect &&
          (running ? (
            <AnnounceCard propertyId={p.id} title="Begehung · Tür ansagen" autoFocus={params.get('ansage') === 'weiter' || params.get('start') === '1'} />
          ) : (
            // erst nach dem Laden entscheiden, ob heute schon begangen wird (kein Springen vom Knopf zum Feld)
            w && <StartBlock p={p} onStart={() => set({ start: '1', tag: null, zeige: null })} />
          ))}
        {walk.isLoading ? (
          <Section>
            <SkeletonList rows={5} className="shadow-none" />
          </Section>
        ) : walk.error || !w ? (
          <Section>
            <ErrorBox error={walk.error ?? new Error('Begehung nicht verfügbar')} onRetry={() => walk.refetch()} />
          </Section>
        ) : (
          <Results p={p} w={w} filter={filter} canInspect={canInspect} onFilter={(f) => set({ zeige: f === 'all' ? null : f })} onDay={(d) => set({ tag: d === w.days[0]?.date ? null : d, zeige: null, start: null, ansage: null })} />
        )}
        <FireWalks p={p} canInspect={canInspect} onStart={() => setWalkStart(true)} />
      </Surface>
    </>
  );
}

/** Der eine große Knopf und der Rundgang als Alternative. */
function StartBlock({ p, onStart }: { p: PropertyDetail; onStart: () => void }) {
  const hasBuilding = p.buildings.length > 0;
  return (
    <Section aria-label="Begehung starten">
      <div className="flex flex-col gap-4 py-2 sm:flex-row sm:items-center sm:gap-6 sm:py-4">
        <Button size="lg" icon={<Mic />} onClick={onStart} disabled={!hasBuilding} className="w-full sm:w-auto sm:min-w-56">
          Begehung starten
        </Button>
        <p className="min-w-0 text-body text-ink-2">
          {hasBuilding ? (
            <>
              Tür für Tür ansagen – „Tür 12, Typ SK32“. <span className="text-ink-3">Nur sagen, was nicht stimmt; der Rest gilt als in Ordnung.</span>
            </>
          ) : (
            'Lege zuerst ein Gebäude an.'
          )}
        </p>
      </div>
      {p.buildings.length > 0 && p.assets.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 pb-1 text-meta text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <Route className="size-3.5" /> Oder als Rundgang in Laufreihenfolge:
          </span>
          {p.buildings.map((b) => (
            <Link key={b.id} to={`/rundgang/${b.id}`} className="text-ink-2 underline decoration-ink-4 underline-offset-4 hover:text-ink">
              {p.buildings.length === 1 ? 'Rundgang starten' : b.name}
            </Link>
          ))}
        </p>
      )}
    </Section>
  );
}

function Results({
  p,
  w,
  filter,
  canInspect,
  onFilter,
  onDay,
}: {
  p: PropertyDetail;
  w: PropertyWalk;
  filter: Filter;
  canInspect: boolean;
  onFilter: (f: Filter) => void;
  onDay: (d: string) => void;
}) {
  const r = walkResult(p.assets, w.inspections, { dayEnd: w.to });
  const shown = filterWalk(r.rows, filter);
  const isToday = w.date === w.today;
  const days = w.days.some((d) => d.date === w.date) ? w.days : [{ date: w.date, count: 0 }, ...w.days];
  const [yy, mm, dd] = w.date.split('-');
  const title = r.done === 0 && !w.days.length ? 'Noch keine Begehung' : isToday ? 'Begehung heute' : `Begehung vom ${dd}.${mm}.${yy}`;
  return (
    <Section
      aria-label="Ergebnis der Begehung"
      title={title}
      action={
        days.length > 1 || !isToday ? (
          <Select aria-label="Tag der Begehung" value={w.date} onChange={(e) => onDay(e.target.value)} className="!h-8 !w-auto max-w-48 !py-0 text-meta">
            {days.map((d) => (
              <option key={d.date} value={d.date}>
                {dayLabel(d.date, w.today)}
                {d.count ? ` · ${d.count}` : ''}
              </option>
            ))}
          </Select>
        ) : undefined
      }
    >
      {/* Handy: Zähler · Folgeschritte · Liste; ab lg die Folgeschritte rechts daneben */}
      <div className="grid grid-cols-1 gap-x-10 gap-y-4 [grid-template-areas:'c'_'s'_'l'] lg:grid-cols-[minmax(0,1fr)_16rem] lg:[grid-template-areas:'c_s'_'l_s']">
        <div className="min-w-0 [grid-area:c]">
          <Counters r={r} filter={filter} onFilter={onFilter} />
        </div>
        <div className="min-w-0 [grid-area:l]">
          {r.rawPending > 0 && (
            <p className="mt-3 text-meta" data-walk-raw>
              <StatusText tone="warn">Diktat noch nicht ausgewertet</StatusText>
              <span className="text-ink-3"> · {n2(r.rawPending, 'Prüfung', 'Prüfungen')}</span>
            </p>
          )}
          {!p.assets.length ? (
            <Empty compact title="Noch keine Elemente" text={canInspect ? 'Angesagte Türen werden gleich angelegt – oder erfasse die Elemente vorab.' : undefined} />
          ) : shown.length === 0 ? (
            <p className="py-4 text-body text-ink-2">Keine Elemente mit diesem Stand.</p>
          ) : (
            <div className="-mx-(--row-px) mt-2">
              <List plain aria-label="Elemente der Begehung">
                {shown.map((row) => (
                  <ResultRow key={row.asset.id} row={row} pid={p.id} />
                ))}
              </List>
            </div>
          )}
        </div>
        {(w.days.length > 0 || w.pending > 0) && <NextSteps p={p} w={w} r={r} />}
      </div>
    </Section>
  );
}

/** Zähler oben – zugleich Filter. */
function Counters({ r, filter, onFilter }: { r: ReturnType<typeof walkResult>; filter: Filter; onFilter: (f: Filter) => void }) {
  const items: { key: Filter; label: string; n: number; tone?: Tone }[] = [
    { key: 'all', label: 'Alle', n: r.rows.length },
    { key: 'ok', label: STATUS.ok.filter, n: r.counts.ok, tone: 'ok' },
    { key: 'defects', label: STATUS.defects.filter, n: r.counts.defects, tone: r.rows.some((x) => x.critical) ? 'bad' : 'warn' },
    { key: 'not_inspectable', label: STATUS.not_inspectable.filter, n: r.counts.not_inspectable, tone: 'muted' },
    { key: 'open', label: STATUS.open.filter, n: r.counts.open },
  ];
  return (
    <div role="group" aria-label="Stand der Begehung" className="-ml-2.5 flex flex-wrap gap-x-1">
      {items
        .filter((x) => x.key === 'all' || x.key === 'open' || x.n > 0 || x.key === filter)
        .map((x) => (
          <button
            key={x.key}
            type="button"
            aria-pressed={filter === x.key}
            data-count={x.key}
            onClick={() => onFilter(filter === x.key && x.key !== 'all' ? 'all' : x.key)}
            className={clsx(
              'flex min-h-11 items-center gap-2 rounded-md px-2.5 text-left transition-colors sm:min-h-9',
              filter === x.key ? 'bg-selected text-ink' : 'text-ink-2 hover:bg-hover hover:text-ink',
            )}
          >
            <span className="inline-flex items-center gap-2 text-body">
              {x.tone && <StatusDot tone={x.tone} />}
              <span className={clsx(filter === x.key && 'font-medium')}>{x.label}</span>
            </span>
            <span className={clsx('text-body tabular-nums', x.tone === 'bad' && x.n > 0 ? 'text-shu' : 'text-ink')}>{x.n}</span>
          </button>
        ))}
    </div>
  );
}

function ResultRow({ row, pid }: { row: WalkRow<Asset>; pid: string }) {
  const a = row.asset;
  const i = row.inspection;
  const st = STATUS[row.status];
  const to = !i ? `/elemente/${a.id}` : i.status === 'submitted' ? `/druck/protokoll/${i.id}` : `/pruefung/${i.id}?ansage=1&objekt=${pid}`;
  const sub = [
    [a.location, a.floor].filter(Boolean).join(', ') || categoryLabel(a.category),
    i && i.defects > 0 && row.status !== 'not_inspectable' ? defectsLabel(i.defects) : null,
    row.unsigned ? 'wartet auf Unterschrift' : row.started ? 'angefangen' : null,
    i && !row.started ? i.inspector : null,
  ].filter(Boolean);
  return (
    <ListRow
      to={to}
      title={
        <>
          {a.code}
          {a.manufacturer || a.model ? <span className="text-ink-3"> · {[a.manufacturer, a.model].filter(Boolean).join(' ')}</span> : null}
        </>
      }
      subtitle={
        <>
          {sub.join(' · ')}
          {(i?.rawPending ?? 0) > 0 && <span className={toneText.warn}> · Diktat noch nicht ausgewertet</span>}
        </>
      }
      trailing={
        <span data-walk-status={row.status} className="text-meta">
          {row.critical ? <ResultBadge result="critical" /> : <StatusText tone={row.status === 'open' && !row.started ? 'muted' : st.tone}>{st.label}</StatusText>}
        </span>
      }
      chevron
    />
  );
}

/** Folgeschritte in fester Reihenfolge, jeweils nur aktiv, wenn sinnvoll. */
function NextSteps({ p, w, r }: { p: PropertyDetail; w: PropertyWalk; r: ReturnType<typeof walkResult> }) {
  const [mappe, setMappe] = useState(false);
  const signed = w.inspections.filter((i) => i.status === 'submitted').length;
  const openDefects = p.assets.reduce((s, a) => s + a.openDefects, 0);
  const steps: { n: number; key: string; label: string; icon: ReactNode; hint: string; active: boolean; to?: string; onClick?: () => void }[] = [
    {
      n: 1,
      key: 'sign',
      label: w.pending ? `Unterschreiben (${w.pending})` : 'Unterschreiben',
      icon: <PenLine />,
      hint: w.pending ? `${n2(w.pending, 'Prüfung wartet', 'Prüfungen warten')} auf deine Unterschrift` : 'Nichts wartet auf deine Unterschrift',
      active: w.pending > 0,
      to: `/unterschreiben?objekt=${p.id}`,
    },
    {
      n: 2,
      key: 'mappe',
      label: 'Sammelmappe',
      icon: <BookCopy />,
      hint: signed ? `${n2(signed, 'Protokoll', 'Protokolle')} dieses Tages in einem PDF` : 'Erst nach dem Unterschreiben',
      active: signed > 0,
      onClick: () => setMappe(true),
    },
    {
      n: 3,
      key: 'offer',
      label: 'Angebotsliste',
      icon: <ReceiptText />,
      hint: openDefects ? `aus ${n2(openDefects, 'offenem Mangel', 'offenen Mängeln')}` : 'Keine offenen Mängel',
      active: openDefects > 0,
      to: `/objekte/${p.id}?tab=maengel&ansicht=angebot`,
    },
  ];
  // der nächste sinnvolle Schritt ist hervorgehoben
  const next = steps.find((s) => s.active)?.key;
  return (
    <nav aria-label="Nach der Begehung" className="min-w-0 [grid-area:s]">
      {mappe && <MappeDialog propertyId={p.id} day={w.date} onClose={() => setMappe(false)} />}
      <h3 className="mb-1 text-meta font-medium text-ink-3">Danach</h3>
      <ol className="flex flex-col border-t border-line">
        {steps.map((s) => {
          const inner = (
            <>
              <span className={clsx('flex size-6 shrink-0 items-center justify-center rounded-full border text-caption tabular-nums', s.key === next ? 'border-ink bg-ink text-white' : 'border-line-strong text-ink-3')}>{s.n}</span>
              <span className="min-w-0 flex-1">
                <span className={clsx('block text-body', s.active ? 'text-ink' : 'text-ink-3')}>{s.label}</span>
                <span className="block text-meta text-ink-3">{s.hint}</span>
              </span>
            </>
          );
          const cls = 'flex min-h-14 w-full items-center gap-3 py-2 text-left';
          return (
            <li key={s.key} className="border-b border-line" data-step={s.key} data-active={s.active ? '1' : undefined}>
              {!s.active ? (
                <span className={clsx(cls, 'cursor-default')} aria-disabled>
                  {inner}
                </span>
              ) : s.to ? (
                <Link to={s.to} className={clsx(cls, 'group hover:[&_span.text-ink]:underline hover:[&_span.text-ink]:decoration-line-strong hover:[&_span.text-ink]:underline-offset-4')}>
                  {inner}
                </Link>
              ) : (
                <button type="button" onClick={s.onClick} className={clsx(cls, 'group hover:[&_span.text-ink]:underline hover:[&_span.text-ink]:decoration-line-strong hover:[&_span.text-ink]:underline-offset-4')}>
                  {inner}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      {r.done > 0 && r.counts.open > 0 && w.date === w.today && <p className="mt-2 text-meta text-ink-3">{n2(r.counts.open, 'Element', 'Elemente')} noch offen.</p>}
    </nav>
  );
}

/** Brandschutzbegehungen (Protokoll nach DGUV) – eigener Abschnitt. */
function FireWalks({ p, canInspect, onStart }: { p: PropertyDetail; canInspect: boolean; onStart: () => void }) {
  const last = p.walkthroughs.find((x) => x.status === 'submitted');
  return (
    <Section
      id="brandschutzbegehungen"
      aria-label="Brandschutzbegehungen"
      title="Brandschutzbegehungen"
      count={p.walkthroughs.length || undefined}
      flush
      action={
        canInspect && (
          <Button size="sm" variant="ghost" icon={p.walkthroughs.length ? <Plus /> : <Footprints />} onClick={onStart} aria-label="Brandschutzbegehung starten">
            {p.walkthroughs.length ? 'Neu' : 'Starten'}
          </Button>
        )
      }
    >
      <p className="-mt-1 mb-2 px-(--row-px) text-meta text-ink-3">
        Das ganze Objekt nach DGUV: Fluchtwege, Beschilderung, Brandlasten.
        {last && (
          <>
            {' '}
            Zuletzt {fmtDate(last.inspectedAt)}
            {last.nextDueAt ? (
              <>
                , nächste <span className={last.nextDueAt < Date.now() ? 'text-shu' : undefined}>{fmtDate(last.nextDueAt)}</span>
              </>
            ) : null}
            .
          </>
        )}
      </p>
      {p.walkthroughs.length > 0 && (
        <List plain aria-label="Begehungen">
          {p.walkthroughs.map((x) => (
            <ListRow
              key={x.id}
              to={x.status === 'draft' ? `/begehung/${x.id}` : `/druck/begehung/${x.id}`}
              title={fmtDateTime(x.inspectedAt ?? x.createdAt)}
              subtitle={[x.inspector, x.buildingName, x.openDefects > 0 ? `${defectsLabel(x.openDefects)} offen` : null].filter(Boolean).join(' · ')}
              trailing={x.status === 'draft' ? <StatusText tone="info">Entwurf</StatusText> : x.result && <ResultBadge result={x.result} />}
              chevron
            />
          ))}
        </List>
      )}
    </Section>
  );
}

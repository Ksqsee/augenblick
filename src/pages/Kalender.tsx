// Kalender (docs/plan/v8.md 1): Monat (Desktop) und Liste (Handy, am Desktop umschaltbar). Einträge aus
// GET /calendar/events: fällige Prüfungen je Objekt und Tag gebündelt, Rundgänge/Begehungen, Fristen von Aufgaben und
// Mängeln, ablaufende Zulassungen und Nachweise. Tipp öffnet das Objekt im passenden Reiter. Überfälliges steht oben in
// einem eigenen Block, unter dem Kalender „Jetzt“ (GET /now, höchstens 5 Zeilen) und „Erledigt für dich“. Eine Fläche, eine Abfrage je Monat.
// Zustand in der URL: ?monat=JJJJ-MM, ?ansicht=monat|liste.
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Fragment } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { addMonths, byDay, CALENDAR_KINDS, type CalendarEvent, monthGrid } from '../../shared/calendar';
import { api, useMe } from '../api';
import { useIsDesktop } from '../components/PropertyNav';
import { ButtonLink, Empty, ErrorBox, PageHeader, Section, Segmented, SkeletonList, Surface } from '../components/ui';
import { DoneForYou, NowSection } from './Dashboard';

interface EventsResponse {
  from: string;
  to: string;
  today: string;
  timeZone: string;
  events: CalendarEvent[];
}

const useCalendarEvents = (from: string, to: string) =>
  useQuery({ queryKey: ['calendar', from, to], queryFn: () => api<EventsResponse>(`/calendar/events?from=${from}&to=${to}`) });

const MONTH = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const DAY_LONG = new Intl.DateTimeFormat('de-DE', { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' });
const DAY_SHORT = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
const WEEKDAYS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
const utc = (day: string) => Date.parse(`${day}T00:00:00Z`);
/** Monat aus der Adresse (JJJJ-MM) oder der aktuelle in der Zeitzone des Workspaces. */
const thisMonth = (tz?: string) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', ...(tz ? { timeZone: tz } : {}) }).format(Date.now());

/** Kleiner Punkt vor einem Eintrag: Zinnober nur für Überfälliges. */
const Dot = ({ e }: { e: CalendarEvent }) => <span aria-hidden className={clsx('mt-[7px] size-1.5 shrink-0 rounded-full', e.overdue ? 'bg-shu' : 'bg-ink-4')} />;

/** Ein Eintrag als Zeile (Überfällig-Block und Liste). */
function EventRow({ e, showDate }: { e: CalendarEvent; showDate?: boolean }) {
  return (
    <li>
      <Link to={e.link} data-event={e.kind} data-date={e.date} className="flex min-h-12 items-start gap-3 px-(--row-px) py-2.5 transition-colors hover:bg-hover">
        <Dot e={e} />
        <span className="min-w-0 flex-1">
          <span className="block text-body text-ink">{e.title}</span>
          <span className="mt-0.5 block text-meta text-ink-3">
            {[showDate && (e.overdue ? `seit ${DAY_SHORT.format(utc(e.date))}` : DAY_SHORT.format(utc(e.date))), CALENDAR_KINDS[e.kind]].filter(Boolean).join(' · ')}
          </span>
        </span>
      </Link>
    </li>
  );
}

export function KalenderPage() {
  const { data: me } = useMe();
  const desktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const tz = me?.tenant.timeZone;
  const current = thisMonth(tz);
  const monat = /^\d{4}-\d{2}$/.test(params.get('monat') ?? '') ? params.get('monat')! : current;
  // Handy: immer Liste; Desktop: Monat, umschaltbar
  const ansicht: 'monat' | 'liste' = desktop && params.get('ansicht') !== 'liste' ? 'monat' : 'liste';
  const grid = monthGrid(monat);
  const from = grid[0]![0]!;
  const to = grid.at(-1)!.at(-1)!;
  const q = useCalendarEvents(from, to);
  const set = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v == null) n.delete(k);
        else n.set(k, v);
        return n;
      },
      { replace: true },
    );
  const today = q.data?.today ?? `${current}-01`;
  const events = q.data?.events ?? [];
  const overdue = events.filter((e) => e.overdue);
  const days = byDay(events.filter((e) => !e.overdue || (e.date >= from && e.date <= to)));
  // Liste: Tage des Monats, im laufenden Monat ab heute
  const listDays = [...days.keys()].filter((d) => d.startsWith(monat) && (monat !== current || d >= today));

  return (
    <>
      <PageHeader
        title="Kalender"
        actions={
          <>
            {desktop && (
              <Segmented
                value={ansicht}
                onChange={(v) => set('ansicht', v === 'monat' ? null : v)}
                options={[
                  { value: 'monat', label: 'Monat' },
                  { value: 'liste', label: 'Liste' },
                ]}
              />
            )}
            <ButtonLink to="/einstellungen?tab=notifications" variant="ghost">
              Abonnieren
            </ButtonLink>
          </>
        }
      />
      <Surface>
        {q.error && (
          <Section>
            <ErrorBox error={q.error} onRetry={() => q.refetch()} />
          </Section>
        )}
        {overdue.length > 0 && (
          <Section title="Überfällig" count={overdue.length} flush>
            <ul className="pk-list" aria-label="Überfällig">
              {overdue.map((e, i) => (
                <EventRow key={`${e.kind}-${e.link}-${i}`} e={e} showDate />
              ))}
            </ul>
          </Section>
        )}
        <Section
          aria-label={ansicht === 'monat' ? 'Monat' : 'Liste'}
          title={<span className="text-h3 font-semibold tracking-[-0.01em] text-ink">{MONTH.format(utc(`${monat}-01`))}</span>}
          action={
            <div className="flex items-center gap-1">
              {monat !== current && (
                <button type="button" onClick={() => set('monat', null)} className="h-8 rounded-md px-2 text-meta font-medium text-ink-2 hover:bg-sunken hover:text-ink">
                  Heute
                </button>
              )}
              <button type="button" aria-label="Voriger Monat" onClick={() => set('monat', addMonths(monat, -1))} className="grid size-8 place-items-center rounded-md text-ink-2 hover:bg-sunken hover:text-ink">
                <ChevronLeft className="size-4" />
              </button>
              <button type="button" aria-label="Nächster Monat" onClick={() => set('monat', addMonths(monat, 1))} className="grid size-8 place-items-center rounded-md text-ink-2 hover:bg-sunken hover:text-ink">
                <ChevronRight className="size-4" />
              </button>
            </div>
          }
          flush={ansicht === 'liste'}
        >
          {q.isLoading ? (
            <SkeletonList rows={5} />
          ) : ansicht === 'monat' ? (
            <MonthGrid grid={grid} month={monat} today={today} days={days} />
          ) : listDays.length ? (
            <div aria-label="Termine">
              {listDays.map((d) => (
                <Fragment key={d}>
                  <h3 id={`tag-${d}`} className={clsx('px-(--row-px) pt-4 pb-1 text-meta font-medium', d === today ? 'text-ink' : 'text-ink-3')}>
                    {d === today ? `Heute, ${DAY_LONG.format(utc(d))}` : DAY_LONG.format(utc(d))}
                  </h3>
                  <ul className="pk-list">
                    {days.get(d)!.map((e, i) => (
                      <EventRow key={`${e.kind}-${e.link}-${i}`} e={e} />
                    ))}
                  </ul>
                </Fragment>
              ))}
            </div>
          ) : (
            <Empty compact title={monat === current ? 'Bis Monatsende steht nichts an.' : 'In diesem Monat steht nichts an.'} />
          )}
        </Section>
        <NowSection max={5} />
        <DoneForYou isAdmin={!!me && ['owner', 'admin'].includes(me.user.role)} />
      </Surface>
    </>
  );
}

/** Monatsraster (Mo–So): je Tag bis zu drei Einträge, der Rest als „+n“ (öffnet die Liste an diesem Tag). */
function MonthGrid({ grid, month, today, days }: { grid: string[][]; month: string; today: string; days: Map<string, CalendarEvent[]> }) {
  const MAX = 3;
  return (
    <div role="grid" aria-label="Monat" className="-mx-1 mt-1">
      <div role="row" className="grid grid-cols-7 border-b border-line pb-1.5">
        {WEEKDAYS.map((w) => (
          <span key={w} role="columnheader" className="px-1.5 text-caption font-medium text-ink-3">
            {w}
          </span>
        ))}
      </div>
      {grid.map((week) => (
        <div role="row" key={week[0]} className="grid grid-cols-7 border-b border-line last:border-b-0">
          {week.map((d) => {
            const list = days.get(d) ?? [];
            const inMonth = d.startsWith(month);
            return (
              <div role="gridcell" key={d} data-day={d} aria-current={d === today ? 'date' : undefined} className="flex min-h-[104px] min-w-0 flex-col gap-0.5 px-1 pt-1.5 pb-2">
                <span
                  className={clsx(
                    'mb-0.5 grid size-6 place-items-center rounded-full text-caption tabular-nums',
                    d === today ? 'bg-ink font-semibold text-white' : inMonth ? 'text-ink-2' : 'text-ink-4',
                  )}
                >
                  {Number(d.slice(8))}
                </span>
                {list.slice(0, MAX).map((e, i) => (
                  <Link
                    key={`${e.kind}-${e.link}-${i}`}
                    to={e.link}
                    data-event={e.kind}
                    data-date={e.date}
                    title={e.title}
                    className={clsx('truncate rounded-sm px-1 py-px text-caption hover:bg-sunken', e.overdue ? 'text-shu' : inMonth ? 'text-ink-2' : 'text-ink-3')}
                  >
                    {e.title}
                  </Link>
                ))}
                {list.length > MAX && (
                  <Link to={`?monat=${month}&ansicht=liste#tag-${d}`} className="px-1 text-caption text-ink-3 hover:text-ink">
                    +{list.length - MAX} weitere
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

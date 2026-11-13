// „Heute“ (Design v3, Vorzeigeseite): Datum + Lage in einem Satz, zwei Knöpfe, Kennzahlen ohne Kasten, „Jetzt“
// (GET /now: was du entscheiden oder tun solltest, eine Aktion je Zeile – am Handy höchstens 5, Rest hinter „Alle“),
// „Erledigt für dich“ (Autopilot-Protokoll). Objekte, offene Punkte und Rundgänge haben eigene Orte (docs/plan/v4.md 5).
// Aufbau: docs/plan/v3.md 2.5, Regeln: docs/design.md
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ScanLine } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { NowItem } from '../../shared/now';
import { api, useAutomationLog, useDashboard, useMe, useNow } from '../api';
import { openCapture } from '../components/CaptureSheet';
import { Button, ButtonLink, Empty, ErrorBox, Input, PageSkeleton, Section, SectionLink, StatTile, Surface, useToast } from '../components/ui';
import { fmtDate, type Tone } from '../format';

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

export const useRounds = (days = 30) =>
  useQuery({
    queryKey: ['smart', 'rounds', days],
    queryFn: () => api<Round[]>(`/smart/rounds?days=${days}`),
  });

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
function Ring({ tone }: { tone: NowItem['tone'] }) {
  return <span aria-hidden className={clsx('mt-[3px] size-3.5 shrink-0 rounded-full border-[1.5px]', tone === 'bad' ? 'border-shu' : 'border-ink-4')} />;
}

/** Eine Zeile unter „Jetzt“: Titel, Erklärung und genau eine Aktion (Endpunkt ausführen oder Ziel öffnen). */
function NowRow({ s, className }: { s: NowItem; className?: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const { endpoint, link, label, body } = s.action;
  const inline = label.length <= 11;
  const run = async () => {
    if (!endpoint) return;
    setBusy(true);
    try {
      const r = await api<{ created?: number }>(endpoint, { body: body ?? {} });
      toast(r.created != null ? `${r.created} ${r.created === 1 ? 'Aufgabe' : 'Aufgaben'} angelegt` : 'Erledigt');
      for (const k of ['now', 'smart', 'tasks', 'dashboard', 'automation', 'asset', 'assets']) qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Fehlgeschlagen', 'bad');
    } finally {
      setBusy(false);
    }
  };
  return (
    <li data-now={s.kind} className={clsx('animate-pop flex min-h-[52px] items-start gap-3 px-(--row-px) py-3 sm:items-center', className)}>
      <Ring tone={s.tone} />
      {/* Aktion rechts in der Zeile; nur ein langer Knopftext (z. B. „Aufgaben anlegen“) rutscht am Handy darunter */}
      <div className={clsx('flex min-w-0 flex-1 gap-3', inline ? 'items-center' : 'flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-3')}>
        <div className="min-w-0 flex-1">
          <p className="text-body text-ink">{s.title}</p>
          <p className="mt-0.5 text-meta text-ink-3">{s.text}</p>
        </div>
        {endpoint ? (
          <Button size="sm" variant="secondary" loading={busy} onClick={run} className="shrink-0">
            {label}
          </Button>
        ) : (
          <Button size="sm" variant="ghost" className={clsx('shrink-0 text-ink', inline ? '-mr-2' : 'max-sm:-ml-3')} onClick={() => navigate(link!)} aria-label={`${s.title}: ${label}`}>
            {label}
          </Button>
        )}
      </div>
    </li>
  );
}

/** „Erledigt für dich“: letzte Einträge des Autopilot-Protokolls (GET /automation/log). Ohne Einträge unsichtbar. */
function DoneForYou({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const log = useAutomationLog(5);
  const items = log.data ?? [];
  if (!items.length) return null;
  const today = new Date().toDateString();
  const undo = async (id: string) => {
    setBusy(id);
    try {
      const r = await api<{ reverted: number; kept: number }>(`/automation/log/${id}/undo`, { body: {} });
      toast(r.kept ? `Rückgängig gemacht (${r.kept} schon bearbeitet, bleibt)` : 'Rückgängig gemacht');
      for (const k of ['automation', 'smart', 'tasks', 'dashboard', 'assets', 'asset']) qc.invalidateQueries({ queryKey: [k] });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Fehlgeschlagen', 'bad');
    } finally {
      setBusy(null);
    }
  };
  return (
    // Das ganze Protokoll steht unter Einstellungen → Automatik (nur Admins)
    <Section id="erledigt" title="Erledigt für dich" action={isAdmin ? <SectionLink to="/einstellungen?tab=automation">Alle</SectionLink> : undefined} flush>
      <ul className="pk-list" aria-label="Erledigt für dich">
        {items.map((e) => {
          const undone = e.undoneAt != null;
          const at = new Date(e.at).toDateString() === today ? timeFmt.format(e.at) : shortFmt.format(e.at);
          return (
            <li key={e.id} data-log={e.id} className="flex min-h-11 items-center gap-3 px-(--row-px) py-2.5 text-body">
              <span className="w-11 shrink-0 text-meta text-ink-3 tabular-nums">{at}</span>
              <span className={clsx('min-w-0 flex-1', undone ? 'text-ink-3 line-through decoration-ink-4' : 'text-ink')}>
                {e.link ? (
                  <Link to={e.link} className="hover:underline">
                    {e.summary}
                  </Link>
                ) : (
                  e.summary
                )}
              </span>
              {!undone && e.undoable && (
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

/**
 * Leeres Konto (Plan v5 Q): ein Feld, ein Knopf. Legt Objekt und still ein Gebäude „Hauptgebäude“ an (POST /properties
 * mit withBuilding) und öffnet gleich „Erfassen“ im Modus Elemente mit diesem Objekt als Ort.
 */
function FirstProperty() {
  const qc = useQueryClient();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ id: string }>('/properties', { body: { name: name.trim(), withBuilding: true } });
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      openCapture({ propertyId: r.id, mode: 'assets' });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Anlegen fehlgeschlagen');
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="flex flex-col gap-3 px-(--row-px) pt-1 pb-8 sm:flex-row sm:items-start sm:pb-10" aria-label="Erstes Objekt anlegen">
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Input
          aria-label="Name des Objekts"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="z. B. Grundschule Am Park"
          autoComplete="off"
          enterKeyHint="go"
        />
        <p className={clsx('text-meta', error ? 'text-shu' : 'text-ink-3')}>{error ?? 'Danach sprichst oder tippst du, was dort verbaut ist.'}</p>
      </div>
      <Button type="submit" size="lg" loading={busy} disabled={!name.trim()} className="sm:h-11">
        Anlegen
      </Button>
    </form>
  );
}

/** Am Handy zeigt „Jetzt“ höchstens so viele Zeilen, der Rest steht hinter „Alle n anzeigen“. */
const MOBILE_NOW = 5;

export function Dashboard() {
  const { data: me } = useMe();
  const { data, isLoading, error, refetch } = useDashboard();
  const [allNow, setAllNow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const now = useNow(allNow);
  const rounds = useRounds(30);
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorBox error={error} onRetry={() => refetch()} />;
  const c = data.counts;
  const canWrite = me?.user.role !== 'viewer';
  const canStructure = me?.user.role === 'owner' || me?.user.role === 'admin';
  // Leeres Konto: nur die Frage nach dem ersten Objekt – kein Lagesatz, keine Kennzahlen, kein „Jetzt“
  const first = c.properties === 0 && canStructure;
  const onlyProperty = data.properties.length === 1 ? data.properties[0] : undefined;
  const topRound = rounds.data?.find((r) => r.overdue + r.due > 0);
  const next = now.data?.items ?? [];
  const more = now.data?.more ?? 0;
  const total = next.length + more;
  const nextDue = (rounds.data ?? []).reduce<number | null>((m, r) => (r.earliest && (!m || r.earliest < m) ? r.earliest : m), null);
  const defects = c.openDefects + c.openWalkDefects;
  const stats: { to: string; tone: Tone; label: string; value: number }[] = [
    { to: '/pruefen?tab=overdue', tone: 'bad', label: 'Überfällig', value: c.overdue },
    { to: '/pruefen?tab=soon', tone: 'warn', label: 'Bald fällig', value: c.soon },
    { to: '/pruefen?tab=never', tone: 'info', label: 'Nie geprüft', value: c.never },
    { to: '/offen?art=maengel', tone: 'brand', label: defects === 1 ? 'Mangel offen' : 'Mängel offen', value: defects },
    { to: '/pruefen?tab=done', tone: 'ok', label: 'Geprüft, 30 T.', value: c.inspections30d },
  ];
  // „Alle n anzeigen“: am Desktop nur, wenn /now mehr hat als geliefert; am Handy schon ab der 6. Zeile
  const mobileCut = !expanded && next.length > MOBILE_NOW;

  return (
    <div className="lg:max-w-[52rem]">
      <Surface>
        <header className="flex flex-col gap-5 px-(--row-px) pt-5 pb-6 sm:pt-7 sm:pb-8">
          {/* Zeile 1: Datum + Aktionen; Zeile 2: die Lage als Satz (h1), darf unter die Aktionen laufen */}
          <div className="flex flex-col gap-1 sm:block">
            {canWrite && c.assets > 0 && (
              <div className="order-last mt-4 flex items-center gap-1 sm:float-right sm:mt-0 sm:ml-6">
                {topRound && <ButtonLink to={`/rundgang/${topRound.buildingId}`}>Rundgang starten</ButtonLink>}
                <ButtonLink to="/scan" variant="ghost" icon={<ScanLine />} aria-label="Code scannen" title="Code scannen" className="px-2.5 sm:px-2.5">
                  <span className="sm:sr-only">Scannen</span>
                </ButtonLink>
              </div>
            )}
            <p className="text-[24px] leading-[30px] font-semibold tracking-[-0.02em] text-ink sm:text-h1">{dayFmt.format(Date.now())}</p>
            <h1 className="text-[24px] leading-[30px] font-medium tracking-[-0.02em] text-pretty text-ink-3 sm:text-h1">
              {first ? 'Wie heißt dein erstes Objekt?' : <Situation assets={c.assets} overdue={c.overdue} critical={c.criticalDefects} soon={c.soon} never={c.never} nextDue={nextDue} />}
            </h1>
          </div>
        </header>

        {first ? (
          <FirstProperty />
        ) : c.assets === 0 ? (
          <Section>
            {c.properties === 0 ? (
              <Empty title="Noch kein Objekt" text="Objekte legt eine Admin-Person an. Danach erfasst du hier die Elemente." />
            ) : (
              <Empty
                title="Noch keine Elemente"
                text={`Sprich oder tippe, was ${onlyProperty ? `in „${onlyProperty.name}“` : 'im Objekt'} verbaut ist – z. B. „drei Feuerschutztüren im EG Flur“.`}
                action={
                  canWrite && me?.user.canCreate !== false && (
                    <Button onClick={() => openCapture({ propertyId: onlyProperty?.id, mode: 'assets' })}>Elemente hinzufügen</Button>
                  )
                }
              />
            )}
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

        {next.length > 0 && !first && (
          <Section title="Jetzt" count={total} flush>
            <ul className="pk-list" aria-label="Jetzt">
              {next.map((s, i) => (
                <NowRow key={s.id} s={s} className={mobileCut && i >= MOBILE_NOW ? 'max-sm:hidden' : undefined} />
              ))}
            </ul>
            {(more > 0 || mobileCut) && (
              <p className={clsx('px-(--row-px) pt-1 pb-3 text-meta text-ink-3', !more && 'sm:hidden')}>
                <button
                  type="button"
                  onClick={() => {
                    setExpanded(true);
                    if (more) setAllNow(true);
                  }}
                  className="min-h-8 font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline"
                >
                  Alle {total} anzeigen
                </button>
              </p>
            )}
          </Section>
        )}

        {!first && <DoneForYou isAdmin={canStructure} />}
      </Surface>
    </div>
  );
}

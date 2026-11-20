// Bausteine der früheren Startseite „Heute“ (bis Plan v8 die Seite `/`). Die Seite selbst entfällt (docs/plan/v8.md 1:
// `/` leitet auf die Objektliste); hier bleiben die wiederverwendbaren Teile: der Ein-Feld-Einstieg im leeren Konto
// (`FirstProperty`, jetzt auf der Objektliste), „Jetzt“ (`NowSection`/`NowRow`, GET /now) und „Erledigt für dich“
// (`DoneForYou`, Autopilot-Protokoll) – beide stehen im Kalender –, der Lagesatz (`Situation`) und die Rundgänge
// (`useRounds`, GET /smart/rounds). Regeln: docs/design.md
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { NowItem } from '../../shared/now';
import { api, useAutomationLog, useNow } from '../api';
import { openCapture } from '../components/CaptureSheet';
import { Button, Input, Section, SectionLink, useToast } from '../components/ui';
import { fmtDate } from '../format';

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

const timeFmt = new Intl.DateTimeFormat('de-DE', {
  hour: '2-digit',
  minute: '2-digit',
});
const shortFmt = new Intl.DateTimeFormat('de-DE', {
  day: '2-digit',
  month: '2-digit',
});

/** Lage in einem Satz. Zahlen in Tinte, „überfällig/kritisch“ in Zinnober, Rest grau. */
export function Situation({ assets, overdue, critical, soon, never, nextDue }: { assets: number; overdue: number; critical: number; soon: number; never: number; nextDue: number | null }) {
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
export function NowRow({ s, className }: { s: NowItem; className?: string }) {
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
export function DoneForYou({ isAdmin }: { isAdmin: boolean }) {
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
export function FirstProperty() {
  const qc = useQueryClient();
  const navigate = useNavigate();
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
      // ins neue Objekt, Reiter Begehung (der nächste Schritt nach den Elementen: Begehung bzw. Rundgang starten –
      // so bleibt der Weg bis zur ersten Prüfung so kurz wie vor v8), darüber gleich „Erfassen“ im Modus Elemente
      navigate(`/objekte/${r.id}?tab=begehung`);
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

/**
 * „Jetzt“ (GET /now) als Abschnitt einer Fläche: was du entscheiden oder tun solltest, eine Aktion je Zeile – am Handy
 * höchstens 5, Rest hinter „Alle n anzeigen“. Ohne Einträge unsichtbar. Steht seit Plan v8 im Kalender.
 */
export function NowSection({ max }: { max?: number } = {}) {
  const [allNow, setAllNow] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const now = useNow(allNow);
  const next = now.data?.items ?? [];
  const more = now.data?.more ?? 0;
  const total = next.length + more;
  // „Alle n anzeigen“: am Desktop nur, wenn /now mehr hat als geliefert; am Handy schon ab der 6. Zeile
  // max: auf allen Breiten kürzen (Kalender), sonst nur am Handy
  const cutAt = max ?? MOBILE_NOW;
  const mobileCut = !expanded && next.length > cutAt;
  const hide = max ? 'hidden' : 'max-sm:hidden';
  if (!next.length) return null;
  return (
    <Section title="Jetzt" count={total} flush>
      <ul className="pk-list" aria-label="Jetzt">
        {next.map((s, i) => (
          <NowRow key={s.id} s={s} className={mobileCut && i >= cutAt ? hide : undefined} />
        ))}
      </ul>
      {(more > 0 || mobileCut) && (
        <p className={clsx('px-(--row-px) pt-1 pb-3 text-meta text-ink-3', !more && !max && 'sm:hidden')}>
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
  );
}

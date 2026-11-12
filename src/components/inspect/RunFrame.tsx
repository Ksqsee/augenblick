// Rahmen für Prüfung und Begehung (v3): Kopf auf dem Beton mit dünner Tintenlinie als Fortschritt,
// Inhalt als eine Surface (setzen die Seiten selbst), feste Abschlussleiste unten.
// Die Leiste sagt immer, was als Nächstes fehlt, und springt mit „Weiter“ genau dorthin.
import clsx from 'clsx';
import { ArrowDown, ArrowLeft, Check, Cloud, CloudOff, HardDrive, Loader2 } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Result } from '../../../shared/logic';
import { RESULT_META } from '../../format';
import { Button, Section, StatusText } from '../ui';
import { ProgressLine } from './Glyph';

export type SaveState = 'saved' | 'saving' | 'error' | 'local';

export function SaveIndicator({ state }: { state: SaveState }) {
  const text = { saving: 'Speichert …', error: 'Nicht gespeichert', saved: 'Gespeichert', local: 'Auf dem Gerät' }[state];
  return (
    <span className={clsx('flex shrink-0 items-center gap-1.5 text-caption', state === 'error' ? 'text-shu' : 'text-ink-3')} aria-live="polite" title={text}>
      {state === 'saving' ? <Loader2 className="size-3.5 animate-spin" /> : state === 'error' ? <CloudOff className="size-3.5" /> : state === 'local' ? <HardDrive className="size-3.5" /> : <Cloud className="size-3.5" />}
      <span className="max-sm:sr-only">{text}</span>
    </span>
  );
}

/** Ein Schritt bis zum Abschluss (Prüfpunkte, Unterschrift …). */
export interface RunStep {
  key: string;
  /** Kurzname in der Liste „Vor dem Abschluss“ */
  label: string;
  done: boolean;
  /** Was fehlt – erscheint in der Leiste, z. B. „Noch 6 Prüfpunkte offen“ */
  todo: string;
  /** Wert rechts in der Liste, z. B. „8/14“ */
  value?: string;
  /** Springt zur Stelle */
  go: () => void;
}

export function RunFrame({
  back,
  icon,
  title,
  subtitle,
  save,
  done,
  total,
  result,
  extraResult,
  steps,
  error,
  submitting,
  onSubmit,
  submitLabel = 'Abschließen',
  children,
}: {
  back: string;
  /** 16-px-Symbol der Elementart (ohne Kachel) */
  icon?: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  save: SaveState;
  done: number;
  total: number;
  result: Result;
  extraResult?: string;
  steps: RunStep[];
  error?: string;
  submitting: boolean;
  onSubmit: () => void;
  submitLabel?: string;
  children: ReactNode;
}) {
  const missing = steps.find((s) => !s.done);
  const pct = total ? Math.round((done / total) * 100) : 100;
  const meta = RESULT_META[result];
  return (
    <div className="min-h-dvh bg-canvas pb-48">
      <header className="sticky top-0 z-30 bg-canvas/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-2 px-2 sm:gap-3 sm:px-4">
          <Link to={back} className="grid size-10 shrink-0 place-items-center rounded-md text-ink-2 hover:bg-hover hover:text-ink" aria-label="Zurück">
            <ArrowLeft className="size-5" />
          </Link>
          {icon && <span className="max-sm:hidden">{icon}</span>}
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-ink">{title}</p>
            <p className="truncate text-caption text-ink-3">{subtitle}</p>
          </div>
          <SaveIndicator state={save} />
          <span className="pr-2 text-meta text-ink-2 tabular-nums sm:pr-0" aria-label={`${done} von ${total} beantwortet`}>
            {done}/{total}
          </span>
        </div>
        <ProgressLine value={pct} />
      </header>

      <div className="animate-in mx-auto flex max-w-3xl flex-col gap-6 px-4 pt-4 sm:pt-6">{children}</div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        {error && (
          <p role="alert" className="mx-auto max-w-3xl px-4 pt-2.5 text-meta text-shu">
            {error}
          </p>
        )}
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          {(() => {
            const inner = (
              <>
                <span className="flex items-center gap-1.5 truncate text-body text-ink">
                  {!missing && <Check className="size-4 shrink-0" strokeWidth={2.25} />}
                  <span className="truncate">{missing ? missing.todo : 'Alles erledigt'}</span>
                </span>
                <StatusText tone={meta.tone} className="mt-0.5 max-w-full">
                  <span className="truncate">
                    {meta.label}
                    {extraResult && ` · ${extraResult}`}
                  </span>
                </StatusText>
              </>
            );
            // Statuszeile: tippbar, solange etwas fehlt (springt dorthin)
            return missing ? (
              <button type="button" onClick={missing.go} className="flex min-w-0 flex-1 flex-col items-start text-left">
                {inner}
              </button>
            ) : (
              <div className="flex min-w-0 flex-1 flex-col items-start" aria-live="polite">
                {inner}
              </div>
            );
          })()}
          {missing ? (
            <Button size="lg" variant="secondary" onClick={missing.go} icon={<ArrowDown />} className="min-w-[8.5rem]">
              Weiter
            </Button>
          ) : (
            <Button size="lg" loading={submitting} onClick={onSubmit} className="min-w-[8.5rem]">
              {submitLabel}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** „Vor dem Abschluss“ (Section in der Surface): alle Schritte mit Abhak-Kreis, offene springen per Tipp an ihre Stelle. */
export function ReadyList({ steps }: { steps: RunStep[] }) {
  const open = steps.filter((s) => !s.done).length;
  return (
    <Section title="Vor dem Abschluss" action={<span className="text-meta text-ink-3">{open ? `${open} offen` : 'Alles erledigt'}</span>} flush aria-label="Vor dem Abschluss">
      <ul className="pk-list" style={{ '--row-inset': '28px' } as CSSProperties}>
        {steps.map((s) => (
          <li key={s.key}>
            <button type="button" onClick={s.go} className="flex min-h-12 w-full items-center gap-3 px-(--row-px) text-left transition-colors hover:bg-hover sm:min-h-11">
              {s.done ? (
                <span className="grid size-4 shrink-0 place-items-center rounded-full bg-ink text-white" aria-hidden>
                  <Check className="size-2.5" strokeWidth={3.5} />
                </span>
              ) : (
                <span aria-hidden className="size-4 shrink-0 rounded-full border-[1.5px] border-ink-4" />
              )}
              <span className={clsx('min-w-0 flex-1 truncate text-body', s.done ? 'text-ink-3' : 'text-ink')}>{s.done ? s.label : s.todo}</span>
              {s.value && <span className="shrink-0 text-meta text-ink-3 tabular-nums">{s.value}</span>}
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

// Rahmen für Prüfung und Begehung: fester Kopf mit Fortschritt, ruhiger Inhalt, feste Abschlussleiste unten.
// Die Leiste sagt immer, was als Nächstes fehlt, und springt mit „Weiter“ genau dorthin.
import clsx from 'clsx';
import { ArrowDown, ArrowLeft, Check, Circle, Cloud, CloudOff, HardDrive, Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Result } from '../../../shared/logic';
import { RESULT_META } from '../../format';
import { Button, Card, StatusDot } from '../ui';

export type SaveState = 'saved' | 'saving' | 'error' | 'local';

export function SaveIndicator({ state }: { state: SaveState }) {
  const text = { saving: 'Speichert …', error: 'Nicht gespeichert', saved: 'Gespeichert', local: 'Auf dem Gerät' }[state];
  return (
    <span className={clsx('flex shrink-0 items-center gap-1.5 text-caption', state === 'error' ? 'text-bad' : 'text-ink-3')} aria-live="polite" title={text}>
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
  icon: ReactNode;
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
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-2 sm:px-4">
          <Link to={back} className="grid size-10 shrink-0 place-items-center rounded-lg text-ink-2 hover:bg-hover hover:text-ink" aria-label="Zurück">
            <ArrowLeft className="size-5" />
          </Link>
          {icon}
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-semibold">{title}</p>
            <p className="truncate text-caption text-ink-3">{subtitle}</p>
          </div>
          <SaveIndicator state={save} />
          <span className="pr-2 text-meta font-medium text-ink-2 tabular-nums sm:pr-0" aria-label={`${done} von ${total} beantwortet`}>
            {done}/{total}
          </span>
        </div>
        <div className="h-[3px] bg-sunken" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Fortschritt">
          <div className="h-full bg-ink transition-[width] duration-200" style={{ width: `${pct}%` }} />
        </div>
      </header>

      <div className="animate-in mx-auto flex max-w-3xl flex-col gap-8 px-4 pt-5 sm:pt-7">{children}</div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
        {error && (
          <p role="alert" className="mx-auto max-w-3xl px-4 pt-2.5 text-meta text-bad">
            {error}
          </p>
        )}
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          {(() => {
            const inner = (
              <>
                <span className={clsx('flex items-center gap-1.5 truncate text-meta font-medium', missing ? 'text-ink' : 'text-ok')}>
                  {!missing && <Check className="size-4 shrink-0" strokeWidth={2.5} />}
                  <span className="truncate">{missing ? missing.todo : 'Alles erledigt'}</span>
                </span>
                <span className="mt-0.5 flex items-center gap-1.5 truncate text-caption text-ink-3">
                  <StatusDot tone={meta.tone} />
                  <span className="truncate">
                    {meta.label}
                    {extraResult && ` · ${extraResult}`}
                  </span>
                </span>
              </>
            );
            // Statuszeile: tippbar, solange etwas fehlt (springt dorthin)
            return missing ? (
              <button type="button" onClick={missing.go} className="min-w-0 flex-1 text-left">
                {inner}
              </button>
            ) : (
              <div className="min-w-0 flex-1" aria-live="polite">
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

/** „Vor dem Abschluss“: alle Schritte mit Haken, offene springen per Tipp an ihre Stelle. */
export function ReadyList({ steps }: { steps: RunStep[] }) {
  const open = steps.filter((s) => !s.done).length;
  return (
    <section aria-labelledby="ready-title">
      <div className="mb-2.5 flex min-h-7 items-center justify-between gap-3">
        <h2 id="ready-title" className="text-title font-semibold tracking-tight">
          Vor dem Abschluss
        </h2>
        <span className={clsx('text-meta', open ? 'text-ink-3' : 'font-medium text-ok')}>{open ? `${open} offen` : 'Alles erledigt'}</span>
      </div>
      <Card className="divide-y divide-line overflow-hidden">
        {steps.map((s) => (
          <button key={s.key} type="button" onClick={s.go} className="flex min-h-12 w-full items-center gap-3 px-4 text-left transition-colors hover:bg-hover">
            {s.done ? (
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-ok text-white">
                <Check className="size-3" strokeWidth={3} />
              </span>
            ) : (
              <Circle className="size-5 shrink-0 text-line-strong" />
            )}
            <span className={clsx('min-w-0 flex-1 truncate text-body', s.done ? 'text-ink-2' : 'font-medium text-ink')}>{s.done ? s.label : s.todo}</span>
            {s.value && <span className="shrink-0 text-meta text-ink-3 tabular-nums">{s.value}</span>}
          </button>
        ))}
      </Card>
    </section>
  );
}

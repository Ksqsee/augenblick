// Prüfpunkt-Zeile: Nummer mit Zustand, Frage, drei große Antwortfelder. Der aktuelle Punkt hat eine orange Markierung.
import clsx from 'clsx';
import { Check, Minus, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { Answer } from '../../../shared/logic';

const ANSWERS: { value: Answer; label: string; short: string; icon: typeof Check; on: string }[] = [
  { value: 'ok', label: 'In Ordnung', short: 'i. O.', icon: Check, on: 'border-ok bg-ok-soft text-ok' },
  { value: 'defect', label: 'Mangel', short: 'Mangel', icon: X, on: 'border-warn bg-warn-soft text-warn' },
  { value: 'na', label: 'Nicht zutreffend', short: 'n. z.', icon: Minus, on: 'border-ink-3 bg-muted-soft text-ink-2' },
];

/** Drei Antwortfelder (i. O. · Mangel · n. z.) als Radiogruppe – 48 px hoch auf dem Handy. */
export function AnswerSegment({ value, onChange, label, className }: { value?: Answer; onChange: (a: Answer) => void; label: string; className?: string }) {
  return (
    <div role="radiogroup" aria-label={label} className={clsx('grid grid-cols-3 gap-1.5', className)}>
      {ANSWERS.map((o) => {
        const Icon = o.icon;
        const sel = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={sel}
            aria-label={o.label}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={clsx(
              'flex h-12 items-center justify-center gap-1.5 rounded-lg border text-meta font-medium transition-[background-color,border-color,color] duration-150 select-none active:scale-[0.97] sm:h-10',
              sel ? o.on : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
            )}
          >
            <Icon className="size-4" strokeWidth={2.5} />
            {o.short}
          </button>
        );
      })}
    </div>
  );
}

/** Kreis mit Nummer bzw. Ergebnis-Symbol. */
export function StepMark({ n, answer }: { n: number; answer?: Answer }) {
  const cls = 'grid size-6 shrink-0 place-items-center rounded-full text-caption font-semibold tabular-nums';
  if (answer === 'ok')
    return (
      <span className={clsx(cls, 'bg-ok-soft text-ok')} aria-hidden>
        <Check className="size-3.5" strokeWidth={3} />
      </span>
    );
  if (answer === 'defect')
    return (
      <span className={clsx(cls, 'bg-warn-soft text-warn')} aria-hidden>
        <X className="size-3.5" strokeWidth={3} />
      </span>
    );
  if (answer === 'na')
    return (
      <span className={clsx(cls, 'bg-sunken text-ink-3')} aria-hidden>
        <Minus className="size-3.5" strokeWidth={3} />
      </span>
    );
  return (
    <span className={clsx(cls, 'border border-line-strong text-ink-3')} aria-hidden>
      {n}
    </span>
  );
}

export function CheckpointRow({
  id,
  n,
  label,
  hint,
  answer,
  current,
  onAnswer,
  children,
}: {
  id: string;
  n: number;
  label: ReactNode;
  hint?: ReactNode;
  answer?: Answer;
  /** nächster offener Punkt – bekommt die Markierung */
  current?: boolean;
  onAnswer: (a: Answer) => void;
  children?: ReactNode;
}) {
  return (
    <div
      data-cp={id}
      data-open={answer ? undefined : ''}
      className={clsx('relative scroll-mt-28 px-4 py-4 transition-colors sm:px-5', current && 'bg-canvas/60')}
    >
      {current && <span aria-hidden className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-brand" />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-6">
        <div className="flex min-w-0 flex-1 gap-3">
          <StepMark n={n} answer={answer} />
          <div className="min-w-0 pt-0.5">
            <p className={clsx('text-body leading-snug', answer === 'na' ? 'text-ink-3' : 'text-ink')}>{label}</p>
            {hint && <div className="mt-0.5 text-meta text-ink-3">{hint}</div>}
          </div>
        </div>
        <AnswerSegment value={answer} label={typeof label === 'string' ? label : `Prüfpunkt ${n}`} onChange={onAnswer} className="sm:w-[16.5rem] sm:shrink-0" />
      </div>
      {children && <div className="mt-3 sm:ml-9">{children}</div>}
    </div>
  );
}

const reduced = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Element mittig in den Blick holen (sanft, außer bei reduzierter Bewegung). */
export function reveal(el: Element | null | undefined, block: ScrollLogicalPosition = 'center') {
  el?.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block });
}

/** Nach einer Antwort zum nächsten offenen Punkt rollen – nur wenn er unten aus dem Blick zu geraten droht. */
export function revealNextOpen(container: HTMLElement | null, afterId: string) {
  if (!container) return;
  window.setTimeout(() => {
    const rows = [...container.querySelectorAll<HTMLElement>('[data-cp]')];
    const i = rows.findIndex((r) => r.dataset.cp === afterId);
    const next = rows.slice(i + 1).find((r) => r.dataset.open !== undefined) ?? rows.find((r) => r.dataset.open !== undefined);
    if (!next) return;
    const r = next.getBoundingClientRect();
    // Unterkante muss über der festen Abschlussleiste (~110 px) liegen
    if (r.top < 90 || r.bottom > window.innerHeight - 120) reveal(next);
  }, 140);
}

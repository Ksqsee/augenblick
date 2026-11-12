// Auswahl-Chips für den Prüfablauf: große Ziele (40 px auf dem Handy); gewählt = Tinte auf `selected` (v3).
import clsx from 'clsx';
import { Check } from 'lucide-react';
import type { ReactNode } from 'react';

const roomy = 'gap-1.5 px-3.5 text-meta';
const tight = 'justify-center gap-1 px-1 text-caption sm:gap-1.5 sm:px-3.5 sm:text-meta';
const base =
  'inline-flex h-10 shrink-0 items-center rounded-md border font-medium whitespace-nowrap transition-[background-color,border-color,color,opacity] duration-150 select-none active:opacity-85 disabled:pointer-events-none disabled:opacity-40 sm:h-9 [&_svg]:size-3.5';
const on = 'border-line-strong bg-selected text-ink';
const off = 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink';

/** An/aus-Chip mit Haken (Mehrfachauswahl, z. B. Prüfart, durchgeführte Arbeiten). */
export function ToggleChip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-pressed={active} onClick={onClick} className={clsx(base, roomy, active ? on : off)}>
      {active && <Check strokeWidth={2.5} />}
      {children}
    </button>
  );
}

/** Einfachauswahl als Chips (role=radiogroup). `leading` z. B. Status-Punkt je Option. */
export function RadioChips<T extends string | null>({
  label,
  value,
  onChange,
  options,
  fill,
  className,
}: {
  /** gleich breite Felder in einer Zeile (Handy) */
  fill?: boolean;
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode; leading?: ReactNode; disabled?: boolean; title?: string }[];
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={clsx(fill ? 'grid gap-1.5 sm:flex sm:flex-wrap' : 'flex flex-wrap gap-1.5', className)}
      style={fill ? { gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` } : undefined}
    >
      {options.map((o) => {
        const sel = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={sel}
            disabled={o.disabled}
            title={o.title}
            onClick={() => onChange(o.value)}
            className={clsx(base, fill ? tight : roomy, sel ? on : off)}
          >
            {o.leading}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

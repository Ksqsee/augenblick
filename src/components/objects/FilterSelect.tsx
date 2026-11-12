import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Auswahl im Stil eines Filter-Chips (für FilterBar): kompakt, aktiv = Tinte gefüllt wie Chip.
 * Für Filter mit vielen Optionen (Art, Objekt), damit die Chip-Reihe kurz bleibt.
 */
export function FilterSelect({ label, value, onChange, children, className }: { label: string; value: string; onChange: (v: string) => void; children: ReactNode; className?: string }) {
  const active = value !== '';
  return (
    <span className={clsx('relative inline-flex shrink-0', className)}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={clsx(
          'h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-lg border py-0 pr-8 pl-3 text-meta font-medium transition-colors focus:ring-[3px] focus:ring-ink/8 focus:outline-none sm:h-8',
          active ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
        )}
      >
        {children}
      </select>
      <ChevronDown className={clsx('pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2', active ? 'text-white/70' : 'text-ink-3')} />
    </span>
  );
}

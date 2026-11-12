import clsx from 'clsx';
import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';

/**
 * Auswahl im Stil eines Filter-Chips (für FilterBar): Radius 6, aktiv = Tinte auf `selected` wie Chip.
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
          'h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border py-0 pr-8 pl-3 text-meta font-medium transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-ink sm:h-8',
          active ? 'border-line-strong bg-selected text-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
        )}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 size-3.5 -translate-y-1/2 text-ink-3" />
    </span>
  );
}

import clsx from 'clsx';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';

/** Kleines Auswahlfeld für die schwebende Leiste. */
export const barFieldCls =
  'h-10 min-w-0 appearance-none rounded-lg border border-line bg-surface pr-7 pl-2.5 text-meta font-medium text-ink transition-colors hover:border-line-strong focus:border-ink-3 focus:outline-none focus:ring-[3px] focus:ring-ink/8 sm:h-8 bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 fill=%27none%27 stroke=%27%238c857b%27 stroke-width=%271.75%27%3E%3Cpath d=%27m4 6 4 4 4-4%27/%3E%3C/svg%3E")] bg-[right_6px_center] bg-no-repeat';

/**
 * Schwebende Leiste für Massenaktionen (Linear/ClickUp-Stil): unten mittig über dem Inhalt,
 * auf dem Handy direkt über der unteren Navigation. Escape hebt die Auswahl auf.
 */
export function BulkBar({ count, onClear, children, error }: { count: number; onClear: () => void; children: ReactNode; error?: ReactNode }) {
  return (
    <div
      role="region"
      aria-label="Mehrfachbearbeitung"
      className="animate-up sm:animate-pop fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 lg:bottom-6 lg:left-[calc(50%+7.5rem)]"
    >
      <div className="flex flex-col gap-2 rounded-2xl bg-surface p-2 shadow-pop sm:flex-row sm:items-center sm:rounded-xl sm:p-1.5">
        <div className="flex items-center gap-1 sm:shrink-0">
          <span className="inline-flex h-8 items-center gap-2 rounded-lg bg-ink pr-1 pl-3 text-meta font-semibold text-white tabular-nums">
            {count} ausgewählt
            <button type="button" onClick={onClear} aria-label="Auswahl aufheben" title="Auswahl aufheben (Esc)" className="grid size-6 place-items-center rounded-md text-white/70 hover:bg-white/15 hover:text-white">
              <X className="size-3.5" />
            </button>
          </span>
        </div>
        <span className="hidden h-6 w-px bg-line sm:block" aria-hidden />
        <div className={clsx('grid grid-cols-2 gap-2 sm:flex sm:items-center sm:gap-1.5')}>{children}</div>
      </div>
      {error && <div className="mt-2">{error}</div>}
    </div>
  );
}

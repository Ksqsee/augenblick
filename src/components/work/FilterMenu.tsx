import clsx from 'clsx';
import { Check, ListFilter } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';

export type FilterOption = { value: string; label: ReactNode; dot?: string };
export type FilterGroupDef = { title: string; label: string; value: string; options: FilterOption[]; onChange: (v: string) => void };

/**
 * „Filter“-Knopf mit aufklappender Liste (statt einer Reihe von Filterknöpfen). Jede Gruppe ist eine
 * Einfachauswahl (erneuter Klick hebt sie auf); die Liste bleibt offen, bis außerhalb geklickt oder Escape gedrückt wird.
 * active = Zahl der gesetzten Filter (erscheint als graue Zahl am Knopf).
 */
export function FilterMenu({ groups, active, onReset }: { groups: FilterGroupDef[]; active: number; onReset?: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      setOpen(false);
    };
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', click);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-meta font-medium whitespace-nowrap transition-colors sm:h-8',
          active || open ? 'border-line-strong bg-selected text-ink' : 'border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink',
        )}
      >
        <ListFilter className="size-3.5" aria-hidden />
        Filter
        {active > 0 && <span className="font-normal text-ink-3 tabular-nums">{active}</span>}
      </button>
      {open && (
        <div role="group" aria-label="Filter" className="animate-menu absolute top-full right-0 z-40 mt-1 w-64 rounded-lg bg-surface p-1 shadow-pop sm:right-auto sm:left-0">
          {groups.map((g, gi) => (
            <div key={g.title} role="group" aria-label={g.label} className={clsx(gi > 0 && 'mt-1 border-t border-line pt-1')}>
              <p className="px-2.5 pt-1.5 pb-1 text-caption font-medium text-ink-3">{g.title}</p>
              {g.options.map((o) => {
                const on = g.value === o.value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    aria-pressed={on}
                    onClick={() => g.onChange(on && o.value ? '' : o.value)}
                    className="flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-body text-ink transition-colors hover:bg-hover sm:h-8"
                  >
                    {o.dot && <span aria-hidden className={clsx('size-1.5 shrink-0 rounded-full', o.dot)} />}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {on && <Check className="size-4 shrink-0 text-ink" aria-hidden />}
                  </button>
                );
              })}
            </div>
          ))}
          {onReset && active > 0 && (
            <div className="mt-1 border-t border-line pt-1">
              <button type="button" onClick={onReset} className="flex h-10 w-full items-center rounded-md px-2.5 text-left text-body text-ink-2 hover:bg-hover hover:text-ink sm:h-8">
                Filter zurücksetzen
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

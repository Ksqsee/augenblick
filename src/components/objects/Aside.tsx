// Seitenspalte auf dem Grund (Design v3): kleine graue Überschrift, Zeilen mit Haarlinien, keine Karten.
// Vorbild: rechte Spalte von „Heute“ (src/pages/Dashboard.tsx).
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

/** Abschnitt der Seitenspalte: Titel (h2, 13 px ink-3) + rechts Aktion, darunter Inhalt. */
export function AsideSection({ title, action, children, className, 'aria-label': ariaLabel }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string; 'aria-label'?: string }) {
  return (
    <section className={clsx('min-w-0', className)} aria-label={ariaLabel}>
      <div className="mb-1 flex min-h-7 items-center justify-between gap-3">
        <h2 className="min-w-0 truncate text-meta font-medium text-ink-3">{title}</h2>
        {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
      </div>
      {children}
    </section>
  );
}

/** Zeilen der Seitenspalte mit Haarlinien oben und zwischen den Einträgen. */
export function AsideList({ children, className, 'aria-label': ariaLabel }: { children: ReactNode; className?: string; 'aria-label'?: string }) {
  return (
    <ul className={clsx('border-t border-line', className)} aria-label={ariaLabel}>
      {children}
    </ul>
  );
}

/** Eine Zeile: links Text (optional zweite Zeile), rechts Wert. to → Link, onClick → Knopf. */
export function AsideRow({
  children,
  sub,
  value,
  to,
  onClick,
  disabled,
  'aria-label': ariaLabel,
}: {
  children: ReactNode;
  sub?: ReactNode;
  value?: ReactNode;
  to?: string;
  onClick?: () => void;
  disabled?: boolean;
  'aria-label'?: string;
}) {
  const inner = (
    <>
      <span className="min-w-0 flex-1">
        <span className={clsx('block truncate text-body text-ink', (to || onClick) && 'group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4')}>{children}</span>
        {sub && <span className="mt-0.5 block truncate text-meta text-ink-3">{sub}</span>}
      </span>
      {value != null && <span className="shrink-0 text-meta text-ink-3 tabular-nums">{value}</span>}
    </>
  );
  const cls = 'group flex min-h-11 w-full items-center gap-3 py-2 text-left';
  return (
    <li className="border-b border-line">
      {to ? (
        <Link to={to} className={cls} aria-label={ariaLabel}>
          {inner}
        </Link>
      ) : onClick ? (
        <button type="button" className={clsx(cls, 'disabled:cursor-default')} onClick={onClick} disabled={disabled} aria-label={ariaLabel}>
          {inner}
        </button>
      ) : (
        <div className={cls}>{inner}</div>
      )}
    </li>
  );
}

/** Kleiner Textknopf für die Aktion einer Seitenspalte („Bearbeiten“, „Bestellen“). */
export function AsideAction({ onClick, children, 'aria-label': ariaLabel }: { onClick: () => void; children: ReactNode; 'aria-label'?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={ariaLabel} className="text-meta font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline">
      {children}
    </button>
  );
}

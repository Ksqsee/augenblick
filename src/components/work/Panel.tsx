import clsx from 'clsx';
import { X } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { IconButton } from '../ui';

/**
 * Detailpanel für Aufgaben und Mängel (v3): rechts einfahrend, eine weiße Fläche. Links der Inhalt in
 * Abschnitten mit Haarlinien, rechts die Eigenschaften als schlichter Text (Bezeichnung grau, Wert in Tinte),
 * getrennt durch eine senkrechte Haarlinie. Auf dem Handy ein Vollbild-Sheet von unten, Eigenschaften oben.
 * Escape schließt nur, wenn kein anderer Dialog darüber liegt.
 */
export function WorkPanel({
  title,
  eyebrow,
  meta,
  actions,
  side,
  footer,
  onClose,
  children,
  label,
}: {
  title: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  side?: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  /** zugänglicher Name, falls der Titel ein Eingabefeld ist */
  label?: string;
}) {
  const titleId = useId();
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (dialogs[dialogs.length - 1] !== ref.current) return;
      close.current();
    };
    window.addEventListener('keydown', h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', h);
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="animate-fade fixed inset-0 z-50 flex items-end justify-end bg-ink/25 sm:items-stretch" onMouseDown={onClose}>
      <aside
        ref={ref}
        role="dialog"
        aria-modal
        aria-labelledby={label ? undefined : titleId}
        aria-label={label}
        onMouseDown={(e) => e.stopPropagation()}
        className="animate-up sm:animate-slide flex h-[100dvh] w-full flex-col bg-surface shadow-pop sm:h-full sm:max-w-[54rem] sm:rounded-l-2xl"
      >
        <header className="shrink-0 border-b border-line px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-4 sm:px-6 sm:pt-4">
          <div className="flex min-h-10 items-center gap-2">
            <div className="min-w-0 flex-1 truncate text-meta text-ink-3">{eyebrow}</div>
            {actions}
            <IconButton label="Schließen" icon={<X />} onClick={onClose} className="-mr-1.5" />
          </div>
          <div id={titleId} className="mt-1 min-w-0 text-h2 font-semibold tracking-[-0.01em] break-words [contain:inline-size]">
            {title}
          </div>
          {meta && <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-3">{meta}</div>}
        </header>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className={clsx('grid min-h-full grid-cols-1', side && 'md:grid-cols-[minmax(0,1fr)_19.5rem]')}>
            <div className="min-w-0 px-4 py-5 sm:px-6 sm:py-6">{children}</div>
            {side && <div className="order-first min-w-0 border-b border-line px-4 py-4 sm:px-6 md:order-none md:border-b-0 md:border-l md:px-5 md:py-6">{side}</div>}
          </div>
        </div>
        {footer && (
          <footer className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-surface px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 [contain:inline-size]">
            {footer}
          </footer>
        )}
      </aside>
    </div>
  );
}

/** Abschnitt im Panel: kleiner grauer Titel (13 px) + Inhalt, Haarlinie darüber (nicht beim ersten). */
export function PanelSection({ title, action, children, className }: { title: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={clsx('mt-6 border-t border-line pt-5 first:mt-0 first:border-t-0 first:pt-0', className)}>
      <div className="mb-2 flex min-h-6 items-center justify-between gap-3">
        <h3 className="text-meta font-medium text-ink-3">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Eigenschaft in der Seitenspalte: Bezeichnung über dem Wert (gestapelt, ruhig). */
export function Prop({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 py-1.5 md:grid md:grid-cols-[7.5rem_minmax(0,1fr)] md:items-start md:gap-2 md:py-0">
      {htmlFor ? (
        <label htmlFor={htmlFor} className="text-caption font-medium text-ink-3 md:py-2.5 md:text-meta md:font-normal">
          {label}
        </label>
      ) : (
        <span className="text-caption font-medium text-ink-3 md:py-2.5 md:text-meta md:font-normal">{label}</span>
      )}
      <div className="flex min-w-0 flex-col justify-center text-body text-ink md:min-h-9 md:py-1">{children ?? <span className="text-ink-4">–</span>}</div>
    </div>
  );
}

/** Schlichtes Auswahlfeld für Eigenschaften – sieht aus wie Text, wird beim Hover zum Feld. */
export const propSelectCls =
  'h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-md border border-transparent bg-transparent pr-7 pl-2 -ml-2 text-body text-ink transition-colors hover:border-line hover:bg-surface focus:border-ink-3 focus:bg-surface focus:outline-none focus:ring-[3px] focus:ring-ink/8 disabled:cursor-default disabled:hover:border-transparent disabled:hover:bg-transparent bg-[url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2716%27 height=%2716%27 fill=%27none%27 stroke=%27%23b7b1a7%27 stroke-width=%271.75%27%3E%3Cpath d=%27m4 6 4 4 4-4%27/%3E%3C/svg%3E")] bg-[right_6px_center] bg-no-repeat disabled:bg-none';

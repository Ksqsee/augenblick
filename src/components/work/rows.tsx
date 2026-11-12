import clsx from 'clsx';
import { Check, RotateCcw } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import { typing } from './model';

/**
 * Abhak-Kreis (Apple-Erinnerungen): leer = dünner Ring in ink-4, erledigt = Tinte mit Haken.
 * „In Arbeit“ = halb gefüllt. Großes Trefferfeld (40 px), sichtbarer Kreis 20 px.
 */
export function StatusToggle({
  done,
  progress,
  onToggle,
  label,
  disabled,
}: {
  done: boolean;
  /** halb gefüllt = „In Arbeit“ */
  progress?: boolean;
  onToggle?: () => void;
  label: string;
  disabled?: boolean;
}) {
  const circle = (
    <span
      className={clsx(
        'relative grid size-5 place-items-center overflow-hidden rounded-full border-[1.5px] transition-colors duration-150',
        done ? 'border-ink bg-ink text-white' : ['border-ink-4', !disabled && 'group-hover/t:border-ink-3'],
      )}
    >
      {done ? (
        <Check className="size-3" strokeWidth={3} />
      ) : (
        <>
          {progress && <span className="absolute inset-y-0 left-0 w-1/2 bg-ink-4" />}
          {!disabled && <Check className="relative size-3 text-ink-3 opacity-0 transition-opacity group-hover/t:opacity-100" strokeWidth={3} />}
        </>
      )}
    </span>
  );
  if (disabled || !onToggle)
    return (
      <span className="grid size-10 shrink-0 place-items-center" role="img" aria-label={done ? 'Erledigt' : progress ? 'In Arbeit' : 'Offen'}>
        {circle}
      </span>
    );
  return (
    <button type="button" onClick={onToggle} aria-label={label} title={label} className="group/t grid size-10 shrink-0 place-items-center rounded-full focus-visible:bg-hover">
      {circle}
    </button>
  );
}

/**
 * Auswahlkästchen einer Zeile. Desktop: im linken Rand der Fläche, erst beim Überfahren sichtbar.
 * Handy: nur im Auswahlmodus, dann anstelle des Abhak-Kreises.
 */
export function RowCheck({ checked, onChange, label, visible }: { checked: boolean; onChange: () => void; label: string; visible: boolean }) {
  return (
    <label
      className={clsx(
        'shrink-0 cursor-pointer items-center self-stretch pr-1 pl-(--row-px) sm:absolute sm:inset-y-0 sm:left-0 sm:z-[1] sm:w-[calc(var(--row-px)-2px)] sm:justify-center sm:p-0',
        visible || checked ? 'flex' : 'hidden sm:flex sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100',
      )}
    >
      <input type="checkbox" className="size-[18px] rounded accent-ink sm:size-3.5" aria-label={label} checked={checked} onChange={onChange} />
    </label>
  );
}

/** Zeilen einer Arbeitsliste: Haarlinien ab dem Textanfang (nach dem Abhak-Kreis), wie bei Erinnerungen. */
export function WorkList({ children, className, ...p }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLUListElement>) {
  return (
    <ul className={clsx('pk-list [--row-inset:32px]', className)} {...p}>
      {children}
    </ul>
  );
}

/** Abstand vor dem Abhak-Kreis: der Kreis (nicht sein Trefferfeld) steht bündig mit den Abschnittstiteln. */
export const rowLeadCls = 'shrink-0 pl-[calc(var(--row-px)-10px)]';

/** Gruppe in einer Arbeitsliste: kleiner grauer Titel (h2) mit Zahl, Haarlinie darüber – kein Balken. */
export function WorkGroup({
  label,
  count,
  select,
  children,
}: {
  label: string;
  count: number;
  select?: { checked: boolean; onChange: (v: boolean) => void; visible: boolean };
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="border-t border-line pb-2 first:border-t-0">
      <div className="group relative flex min-h-6 items-center gap-2 px-(--row-px) pt-5 pb-1.5 sm:pt-6">
        {select && (
          <label
            className={clsx(
              'cursor-pointer items-center sm:absolute sm:bottom-1.5 sm:left-0 sm:h-6 sm:w-[calc(var(--row-px)-2px)] sm:justify-center',
              select.visible || select.checked ? 'flex' : 'hidden sm:flex sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100',
            )}
          >
            <input type="checkbox" className="size-[18px] rounded accent-ink sm:size-3.5" aria-label={`Alle in „${label}“ auswählen`} checked={select.checked} onChange={(e) => select.onChange(e.target.checked)} />
          </label>
        )}
        <h2 className="text-meta font-medium text-ink-3">{label}</h2>
        <span className="text-meta text-ink-3 tabular-nums">{count}</span>
      </div>
      <WorkList>{children}</WorkList>
    </section>
  );
}

/**
 * Wischen nach rechts (nur Touch) löst die Hauptaktion aus – wie in Mail/Things.
 * Vertikales Scrollen bleibt unberührt; ohne Touch passiert nichts.
 */
export function useSwipe(onSwipe: (() => void) | undefined, label: string, done = false) {
  const [dx, setDx] = useState(0);
  const start = useRef<{ x: number; y: number; id: number; horizontal: boolean | null } | null>(null);
  const swiped = useRef(false);
  const last = useRef(0);
  const LIMIT = 96;
  const handlers = onSwipe
    ? {
        onPointerDown: (e: React.PointerEvent) => {
          if (e.pointerType !== 'touch') return;
          start.current = { x: e.clientX, y: e.clientY, id: e.pointerId, horizontal: null };
          swiped.current = false;
        },
        onPointerMove: (e: React.PointerEvent) => {
          const s = start.current;
          if (!s || s.id !== e.pointerId) return;
          const x = e.clientX - s.x;
          const y = e.clientY - s.y;
          if (s.horizontal === null && (Math.abs(x) > 8 || Math.abs(y) > 8)) s.horizontal = Math.abs(x) > Math.abs(y) && x > 0;
          if (s.horizontal) {
            last.current = Math.max(0, Math.min(LIMIT + 24, x));
            setDx(last.current);
          }
        },
        onPointerUp: () => {
          if (start.current?.horizontal) {
            swiped.current = true;
            if (last.current >= LIMIT * 0.75) onSwipe();
          }
          start.current = null;
          last.current = 0;
          setDx(0);
        },
        onPointerCancel: () => {
          start.current = null;
          setDx(0);
        },
        onClickCapture: (e: React.MouseEvent) => {
          if (swiped.current) {
            e.preventDefault();
            e.stopPropagation();
            swiped.current = false;
          }
        },
      }
    : {};
  const armed = dx >= LIMIT * 0.75;
  const underlay =
    dx > 0 ? (
      <span aria-hidden className={clsx('absolute inset-y-0 left-0 flex items-center gap-2 pl-5 text-meta font-medium text-white transition-colors', armed ? 'bg-ink' : 'bg-ink-3')} style={{ width: dx + 16 }}>
        {done ? <RotateCcw className="size-4" /> : <Check className="size-4" strokeWidth={3} />}
        {dx > 64 && label}
      </span>
    ) : null;
  const style = dx ? { transform: `translateX(${dx}px)` } : undefined;
  return { handlers, underlay, style, moving: dx > 0 };
}

/**
 * Tastatur in Listen: ↑/↓ bzw. j/k springen zwischen Zeilen, x wählt die Zeile aus.
 * Zeilen-Hauptknöpfe tragen data-row-main, die Zeile data-row-id.
 */
export function listKeys(onSelect?: (id: string) => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    if (typing(e.nativeEvent) && (e.target as HTMLElement).getAttribute('type') !== 'checkbox') return;
    const rows = [...e.currentTarget.querySelectorAll<HTMLElement>('[data-row-main]')];
    const i = rows.findIndex((r) => r.contains(document.activeElement) || r === document.activeElement || r.closest('li')?.contains(document.activeElement));
    const key = e.key;
    if (key === 'ArrowDown' || key === 'j' || key === 'ArrowUp' || key === 'k') {
      e.preventDefault();
      const next = key === 'ArrowDown' || key === 'j' ? Math.min(rows.length - 1, i + 1) : Math.max(0, i - 1);
      rows[i < 0 ? 0 : next]?.focus();
    } else if (key === 'x' && onSelect && i >= 0) {
      e.preventDefault();
      const id = rows[i].closest<HTMLElement>('[data-row-id]')?.dataset.rowId;
      if (id) onSelect(id);
    }
  };
}

/** Aktion als Textlink (für Leerzustände): Tinte, feine Unterstreichung. */
export function TextAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick} className="text-body font-medium text-ink underline decoration-line-strong underline-offset-4 transition-colors hover:decoration-ink">
      {children}
    </button>
  );
}

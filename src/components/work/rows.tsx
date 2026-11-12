import clsx from 'clsx';
import { Check, RotateCcw } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import type { Tone } from '../../format';
import { StatusDot } from '../ui';
import { typing } from './model';

/**
 * Runder Erledigt-Schalter (Things-Stil). done = grün gefüllt mit Haken.
 * Großes Trefferfeld (40 px), sichtbarer Kreis 20 px.
 */
export function StatusToggle({
  done,
  progress,
  onToggle,
  label,
  disabled,
  tone,
}: {
  done: boolean;
  /** halb gefüllt = „In Arbeit“ */
  progress?: boolean;
  onToggle?: () => void;
  label: string;
  disabled?: boolean;
  /** Farbe des leeren Kreises (z. B. bad bei kritisch) */
  tone?: Tone;
}) {
  const ring = tone === 'bad' ? 'border-bad/60' : tone === 'warn' ? 'border-warn/60' : 'border-line-strong';
  const circle = (
    <span
      className={clsx(
        'relative grid size-5 place-items-center rounded-full border-[1.5px] transition-[background-color,border-color,transform] duration-150',
        done ? 'border-ok bg-ok text-white' : [ring, !disabled && 'group-hover/t:border-ok group-hover/t:bg-ok-soft group-active/t:scale-90'],
      )}
    >
      {done ? (
        <Check className="size-3" strokeWidth={3} />
      ) : (
        <>
          {progress && <span className="absolute inset-[3px] rounded-full bg-[conic-gradient(var(--color-info)_0_50%,transparent_50%_100%)]" />}
          {!disabled && <Check className="size-3 text-ok opacity-0 transition-opacity group-hover/t:opacity-100" strokeWidth={3} />}
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
    <button type="button" onClick={onToggle} aria-label={label} title={label} className="group/t grid size-10 shrink-0 place-items-center rounded-full focus-visible:bg-sunken">
      {circle}
    </button>
  );
}

/** Auswahlkästchen am Zeilenanfang: Desktop erst beim Überfahren, Handy nur im Auswahlmodus. */
export function RowCheck({ checked, onChange, label, visible }: { checked: boolean; onChange: () => void; label: string; visible: boolean }) {
  return (
    <label
      className={clsx(
        'h-full shrink-0 cursor-pointer items-center self-stretch pr-1 pl-4 sm:pr-0 sm:pl-2',
        visible || checked ? 'flex' : 'hidden sm:flex sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100',
      )}
    >
      <input type="checkbox" className="size-[18px] rounded accent-ink sm:size-4" aria-label={label} checked={checked} onChange={onChange} />
    </label>
  );
}

/** Gruppe in einer Arbeitsliste: eigener Abschnitt mit Überschrift (Linear-Stil). */
export function WorkGroup({
  label,
  count,
  tone,
  select,
  children,
}: {
  label: string;
  count: number;
  tone?: Tone;
  select?: { checked: boolean; onChange: (v: boolean) => void; visible: boolean };
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="border-b border-line last:border-b-0">
      <div className="group flex h-9 items-center gap-2 border-b border-line bg-canvas/70 pr-4 pl-4 sm:pl-2">
        {select && (
          <label className={clsx('cursor-pointer items-center', select.visible || select.checked ? 'flex' : 'hidden sm:flex sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100')}>
            <input type="checkbox" className="size-4 rounded accent-ink" aria-label={`Alle in „${label}“ auswählen`} checked={select.checked} onChange={(e) => select.onChange(e.target.checked)} />
          </label>
        )}
        {tone && <StatusDot tone={tone} className={select ? 'sm:ml-1' : undefined} />}
        <h2 className={clsx('text-meta font-semibold', tone === 'bad' ? 'text-bad' : 'text-ink-2')}>{label}</h2>
        <span className="text-meta text-ink-3 tabular-nums">{count}</span>
      </div>
      <ul className="divide-y divide-line">{children}</ul>
    </section>
  );
}

/** Priorität als drei Balken (lesbar ohne Farbe) + Text für Screenreader. */
export function PriorityGlyph({ level, tone, label, className, kind = 'Priorität' }: { level: number; tone: Tone; label: string; className?: string; kind?: string }) {
  return (
    <span className={clsx('inline-flex shrink-0 items-center', tone === 'bad' ? 'text-bad' : 'text-ink-3', className)} title={`${kind}: ${label}`}>
      <svg viewBox="0 0 12 12" className="size-3.5" aria-hidden>
        {[0, 1, 2].map((i) => (
          <rect key={i} x={1 + i * 4} y={8 - i * 3} width="2.5" height={3 + i * 3} rx="0.75" fill="currentColor" opacity={i < level ? 1 : 0.22} />
        ))}
      </svg>
      <span className="sr-only">
        {kind} {label}
      </span>
    </span>
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
      <span aria-hidden className={clsx('absolute inset-y-0 left-0 flex items-center gap-2 pl-5 text-meta font-semibold text-white transition-colors', armed ? 'bg-ok' : 'bg-ok/70')} style={{ width: dx + 16 }}>
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

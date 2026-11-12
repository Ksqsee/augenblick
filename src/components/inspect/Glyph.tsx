// Kleine v3-Bausteine für den Bereich Prüfen: Elementart als 16-px-Liniensymbol (ohne Kachel)
// und Fortschritt als dünne Tintenlinie.
import clsx from 'clsx';
import { Box, DoorClosed, Fan, FireExtinguisher, Siren } from 'lucide-react';
import type { Category } from '../../../shared/catalog';

const BUILTIN: Record<string, typeof DoorClosed> = { fire_door: DoorClosed, damper: Fan, extinguisher: FireExtinguisher, smoke_alarm: Siren };

/** Elementart: 16-px-Linie in ink-3, kein Hintergrund. */
export function CategoryGlyph({ category, className }: { category: Category | string; className?: string }) {
  const Icon = BUILTIN[category] ?? Box;
  return <Icon aria-hidden className={clsx('size-4 shrink-0 text-ink-3', className)} strokeWidth={1.75} />;
}

/** Dünne Fortschrittslinie in Tinte auf Haarlinie (role=progressbar). */
export function ProgressLine({ value, label = 'Fortschritt', className }: { value: number; label?: string; className?: string }) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className={clsx('h-0.5 bg-line', className)} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="h-full bg-ink transition-[width] duration-200" style={{ width: `${pct}%` }} />
    </div>
  );
}

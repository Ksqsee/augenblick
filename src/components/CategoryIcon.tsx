import clsx from 'clsx';
import { Box, DoorClosed, Fan, FireExtinguisher, Siren } from 'lucide-react';
import type { Category } from '../../shared/catalog';

const BUILTIN: Record<string, typeof DoorClosed> = {
  fire_door: DoorClosed,
  damper: Fan,
  extinguisher: FireExtinguisher,
  smoke_alarm: Siren,
};

/**
 * Symbol einer Elementart (Design v3): 16-px-Linie in ink-3, ohne Kachel und ohne Farbe.
 * `size` bleibt aus Kompatibilität; beide Größen sind 16 px.
 */
export function CategoryIcon({ category, className }: { category: Category; size?: 'sm' | 'md'; className?: string }) {
  const Icon = BUILTIN[category] ?? Box;
  return <Icon aria-hidden strokeWidth={1.75} className={clsx('size-4 shrink-0 text-ink-3', className)} />;
}

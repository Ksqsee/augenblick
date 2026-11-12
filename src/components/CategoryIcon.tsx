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
 * Farbtöne für frei wählbare Farben (Etiketten, eigene Elementarten in den Einstellungen).
 * Nicht für das Symbol einer Elementart – das ist seit v3 einfarbig.
 */
export const COLOR_CLASSES: Record<string, string> = {
  slate: 'bg-[#eef0f3] text-[#334155]',
  orange: 'bg-[#fdeee6] text-[#c2410c]',
  blue: 'bg-[#e8effd] text-[#1d4ed8]',
  red: 'bg-[#fde8e8] text-[#c81e1e]',
  green: 'bg-[#e7f5ec] text-[#15803d]',
  violet: 'bg-[#f1ebfd] text-[#6d28d9]',
  teal: 'bg-[#e3f4f3] text-[#0f766e]',
  amber: 'bg-[#fdf3e1] text-[#b45309]',
};

/**
 * Symbol einer Elementart (Design v3): 16-px-Linie in ink-3, ohne Kachel und ohne Farbe.
 * `size` bleibt aus Kompatibilität; beide Größen sind 16 px.
 */
export function CategoryIcon({ category, className }: { category: Category; size?: 'sm' | 'md'; className?: string }) {
  const Icon = BUILTIN[category] ?? Box;
  return <Icon aria-hidden strokeWidth={1.75} className={clsx('size-4 shrink-0 text-ink-3', className)} />;
}

import clsx from 'clsx';
import { Box, DoorClosed, Fan, FireExtinguisher, Siren } from 'lucide-react';
import type { Category } from '../../shared/catalog';
import { getCategory } from '../categories';

const BUILTIN: Record<string, { icon: typeof DoorClosed; cls: string }> = {
  fire_door: { icon: DoorClosed, cls: 'bg-[#fdeee6] text-[#c2410c]' },
  damper: { icon: Fan, cls: 'bg-[#e8effd] text-[#1d4ed8]' },
  extinguisher: { icon: FireExtinguisher, cls: 'bg-[#fde8e8] text-[#c81e1e]' },
  smoke_alarm: { icon: Siren, cls: 'bg-[#eef2e6] text-[#4d7c0f]' },
};

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

export function CategoryIcon({ category, size = 'md' }: { category: Category; size?: 'sm' | 'md' }) {
  const m = BUILTIN[category] ?? { icon: Box, cls: COLOR_CLASSES[getCategory(category).color ?? 'slate'] ?? COLOR_CLASSES.slate };
  const Icon = m.icon;
  return (
    <span className={clsx('grid shrink-0 place-items-center rounded-lg', m.cls, size === 'md' ? 'size-10' : 'size-8')}>
      <Icon className={size === 'md' ? 'size-5' : 'size-4'} />
    </span>
  );
}

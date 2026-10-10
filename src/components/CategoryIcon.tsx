import clsx from 'clsx';
import { DoorClosed, FireExtinguisher, Fan, Siren } from 'lucide-react';
import type { Category } from '../../shared/catalog';

const META: Record<Category, { icon: typeof DoorClosed; cls: string }> = {
  fire_door: { icon: DoorClosed, cls: 'bg-[#fdeee6] text-[#c2410c]' },
  damper: { icon: Fan, cls: 'bg-[#e8effd] text-[#1d4ed8]' },
  extinguisher: { icon: FireExtinguisher, cls: 'bg-[#fde8e8] text-[#c81e1e]' },
  smoke_alarm: { icon: Siren, cls: 'bg-[#eef2e6] text-[#4d7c0f]' },
};

export function CategoryIcon({ category, size = 'md' }: { category: Category; size?: 'sm' | 'md' }) {
  const m = META[category];
  const Icon = m.icon;
  return (
    <span className={clsx('grid shrink-0 place-items-center rounded-lg', m.cls, size === 'md' ? 'size-10' : 'size-8')}>
      <Icon className={size === 'md' ? 'size-5' : 'size-4'} />
    </span>
  );
}

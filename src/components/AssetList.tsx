import { ChevronRight } from 'lucide-react';
import type { Asset } from '../api';
import { assetDue, categoryLabel, defectsLabel, DUE_META, fmtDate } from '../format';
import { summarizeSchedules } from '../../shared/logic';
import { scheduleLabel } from '../categories';
import { CategoryIcon } from './CategoryIcon';
import { Badge } from './ui';

export function DueBadge({ asset }: { asset: Pick<Asset, 'nextDueAt' | 'lastResult'> }) {
  if (asset.lastResult === 'not_inspectable') return <Badge tone="muted" dot>Nicht prüfbar</Badge>;
  const m = DUE_META[assetDue(asset.nextDueAt)];
  return (
    <Badge tone={m.tone} dot>
      {m.label}
    </Badge>
  );
}

export function AssetList({ assets, onSelect, showPlace = true }: { assets: Asset[]; onSelect: (a: Asset) => void; showPlace?: boolean }) {
  return (
    <ul className="divide-y divide-line">
      {assets.map((a) => (
        <li key={a.id}>
          <button onClick={() => onSelect(a)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-sunken/60 sm:px-5">
            <CategoryIcon category={a.category} size="sm" />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                {a.code}
                <span className="hidden font-normal text-ink-3 sm:inline">{categoryLabel(a.category)}</span>
              </span>
              <span className="block truncate text-xs text-ink-3">
                {[a.location, a.floor, showPlace ? `${a.buildingName} · ${a.propertyName}` : null].filter(Boolean).join(' · ') || '–'}
              </span>
            </span>
            <span className="hidden w-28 text-right text-xs text-ink-3 md:block">
              <span className="block text-[11px]">{nextLabel(a)}</span>
              <span className="font-medium text-ink-2">{fmtDate(a.nextDueAt)}</span>
            </span>
            <span className="flex flex-col items-end gap-1">
              <DueBadge asset={a} />
              {a.openDefects > 0 && <Badge tone="warn">{defectsLabel(a.openDefects)}</Badge>}
            </span>
            <ChevronRight className="size-4 text-ink-3" />
          </button>
        </li>
      ))}
    </ul>
  );
}

function nextLabel(a: Asset) {
  const k = a.schedules ? summarizeSchedules(a.schedules).nextKey : null;
  return k && k !== 'main' ? scheduleLabel(a.category, k) : 'nächste Prüfung';
}

import type { Asset } from '../api';
import { AssetRow, AssetStatusBadge } from './objects/status';
import { ListGroup } from './ui';
import { assetDue, type Tone } from '../format';

/** Prüfstatus eines Elements als Badge (auch „Nicht prüfbar“). */
export function DueBadge({ asset }: { asset: Pick<Asset, 'nextDueAt' | 'lastResult'> }) {
  return <AssetStatusBadge asset={asset} />;
}

const GROUPS: { key: string; title: string; tone: Tone }[] = [
  { key: 'overdue', title: 'Überfällig', tone: 'bad' },
  { key: 'soon', title: 'Bald fällig', tone: 'warn' },
  { key: 'never', title: 'Nie geprüft', tone: 'info' },
  { key: 'ok', title: 'Aktuell', tone: 'ok' },
  { key: 'muted', title: 'Nicht prüfbar', tone: 'muted' },
];
const groupOf = (a: Asset) => (a.lastResult === 'not_inspectable' ? 'muted' : assetDue(a.nextDueAt));
const byDue = (a: Asset, b: Asset) => (a.nextDueAt ?? 0) - (b.nextDueAt ?? 0) || a.code.localeCompare(b.code, 'de', { numeric: true });

/**
 * Elementzeilen (ul). grouped = nach Prüfstatus gruppiert (dringendes zuerst), sonst in gegebener Reihenfolge.
 * Für den Rahmen sorgt der Aufrufer (List/Card).
 */
export function AssetList({ assets, onSelect, showPlace = true, grouped }: { assets: Asset[]; onSelect: (a: Asset) => void; showPlace?: boolean; grouped?: boolean }) {
  if (!grouped)
    return (
      <ul className="divide-y divide-line">
        {assets.map((a) => (
          <AssetRow key={a.id} asset={a} showPlace={showPlace} onClick={() => onSelect(a)} />
        ))}
      </ul>
    );
  return (
    <ul className="divide-y divide-line">
      {GROUPS.map((g) => {
        const items = assets.filter((a) => groupOf(a) === g.key).sort(byDue);
        if (!items.length) return null;
        return [
          <ListGroup key={g.key} title={g.title} count={items.length} tone={g.tone} />,
          ...items.map((a) => <AssetRow key={a.id} asset={a} showPlace={showPlace} onClick={() => onSelect(a)} />),
        ];
      })}
    </ul>
  );
}

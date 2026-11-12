import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { api, type Asset, useTaskLabels } from '../../api';
import { COLOR_CLASSES } from '../CategoryIcon';

/** Vorschlagsliste für Element-Codes (aus dem Zugriffsbereich). */
export function AssetCodes({ id = 'task-asset-codes' }: { id?: string }) {
  const [codes, setCodes] = useState<string[]>([]);
  useEffect(() => {
    let off = false;
    api<Asset[]>('/assets')
      .then((rows) => !off && setCodes(rows.map((a) => a.code).slice(0, 2000)))
      .catch(() => {});
    return () => {
      off = true;
    };
  }, []);
  return (
    <datalist id={id}>
      {codes.map((c) => (
        <option key={c} value={c} />
      ))}
    </datalist>
  );
}

/** Label als kleiner farbiger Chip. */
export function LabelChip({ id }: { id: string }) {
  const { data } = useTaskLabels();
  const l = data?.find((x) => x.id === id);
  if (!l) return null;
  return <span className={clsx('inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-[11px] font-medium', COLOR_CLASSES[l.color])}>{l.name}</span>;
}

/** Labels an/aus (Mehrfachauswahl als Chips). */
export function LabelPicker({ value, onChange, disabled }: { value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const labels = useTaskLabels();
  if (!labels.data?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {labels.data.map((l) => {
        const on = value.includes(l.id);
        return (
          <button
            key={l.id}
            type="button"
            aria-pressed={on}
            disabled={disabled}
            onClick={() => onChange(on ? value.filter((x) => x !== l.id) : [...value, l.id])}
            className={clsx(
              'inline-flex h-8 items-center rounded-md px-2 text-caption font-medium transition sm:h-6',
              on ? COLOR_CLASSES[l.color] : 'bg-sunken text-ink-3 hover:text-ink-2',
              disabled && !on && 'hidden',
            )}
          >
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

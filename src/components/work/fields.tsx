import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { api, type Asset, useTaskLabels } from '../../api';
import { SEVERITIES, type Severity } from '../../../shared/catalog';

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

/** Labelfarbe nur als 6-px-Punkt, gemappt auf die gedämpften Status-Töne (keine Rohfarben). */
const LABEL_DOT: Record<string, string> = {
  red: 'bg-shu',
  orange: 'bg-warn',
  amber: 'bg-warn',
  green: 'bg-ok',
  teal: 'bg-ok',
  blue: 'bg-info',
  violet: 'bg-info',
  slate: 'bg-ink-4',
};
export const labelDot = (color: string | null | undefined) => LABEL_DOT[color ?? ''] ?? 'bg-ink-4';

/** Label als schlichter Text mit Farbpunkt („● Wartungsvertrag“) – für die Meta-Zeile. */
export function LabelText({ id }: { id: string }) {
  const { data } = useTaskLabels();
  const l = data?.find((x) => x.id === id);
  if (!l) return null;
  return (
    <span className="whitespace-nowrap">
      <span aria-hidden className={clsx('mr-1 inline-block size-1.5 rounded-full align-middle', labelDot(l.color))} />
      <span>{l.name}</span>
    </span>
  );
}

/** Schweregrad als Punkt + Wort. Nur „Kritisch“ in Zinnober, „Hoch“ mit Ocker-Punkt, sonst grau. */
export function SeverityText({ severity, className }: { severity: Severity; className?: string }) {
  const critical = severity === 'critical';
  return (
    <span className={clsx('inline-flex shrink-0 items-center gap-1.5 text-meta whitespace-nowrap', critical ? 'font-medium text-shu' : 'text-ink-2', className)}>
      <span aria-hidden className={clsx('size-1.5 shrink-0 rounded-full', critical ? 'bg-shu' : severity === 'high' ? 'bg-warn' : 'bg-ink-4')} />
      {SEVERITIES[severity]}
    </span>
  );
}

/** Labels an/aus (Mehrfachauswahl). Neutral: Rahmen + Farbpunkt, gewählt = Tinte auf „selected“. */
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
              'inline-flex h-8 items-center gap-1.5 rounded-md border px-2 text-caption font-medium transition-colors sm:h-7',
              on ? 'border-line-strong bg-selected text-ink' : 'border-line text-ink-3 hover:text-ink-2',
              disabled && 'cursor-default',
              disabled && !on && 'hidden',
            )}
          >
            <span aria-hidden className={clsx('size-1.5 rounded-full', labelDot(l.color))} />
            {l.name}
          </button>
        );
      })}
    </div>
  );
}

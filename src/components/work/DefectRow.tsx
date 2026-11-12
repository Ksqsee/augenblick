import clsx from 'clsx';
import { Footprints } from 'lucide-react';
import { SEVERITIES } from '../../../shared/catalog';
import { type Defect, fileUrl } from '../../api';
import { fmtRelative } from '../../format';
import { CategoryIcon } from '../CategoryIcon';
import { Badge, SEVERITY_TONE, SeverityBadge } from '../ui';
import { PriorityGlyph, StatusToggle, useSwipe } from './rows';

const SEV_LEVEL = { low: 1, medium: 2, high: 3, critical: 3 } as const;

/**
 * Mangelzeile: Behoben-Kreis · Element-Symbol · Titel mit Ort und Maßnahme · rechts Fotos, Zeit, Schweregrad.
 * Wischen nach rechts (Handy) öffnet „Beheben“.
 */
export function DefectRow({ d, canEdit, onOpen, onResolve, onReopen }: { d: Defect; canEdit: boolean; onOpen: () => void; onResolve: () => void; onReopen: () => void }) {
  const resolved = d.status === 'resolved';
  const editable = canEdit && !d.hiddenAt;
  const swipe = useSwipe(editable && !resolved ? onResolve : undefined, 'Beheben');
  const sevTone = SEVERITY_TONE[d.severity];
  const where = [d.code ?? 'Begehung', d.location, d.propertyName].filter(Boolean).join(' · ');
  const detail = d.hiddenAt
    ? `Ausgeblendet: ${d.hiddenReason ?? ''}`
    : resolved
      ? [`Behoben${d.resolvedByName ? ` von ${d.resolvedByName}` : ''}`, d.resolutionNote].filter(Boolean).join(' – ')
      : [d.note, d.measure && `Maßnahme: ${d.measure}`].filter(Boolean).join(' · ');
  return (
    <li data-defect={d.id} data-row-id={d.id} className="group relative overflow-hidden bg-surface">
      {swipe.underlay}
      <div
        {...swipe.handlers}
        style={swipe.style}
        className={clsx('relative flex touch-pan-y items-center bg-surface transition-colors hover:bg-hover focus-within:shadow-[inset_2px_0_0_var(--color-brand)]', !swipe.moving && 'transition-transform duration-200')}
      >
        <span className="shrink-0 pl-1.5">
          <StatusToggle
            done={resolved}
            disabled={!editable}
            tone={!resolved ? (d.severity === 'critical' || d.severity === 'high' ? 'bad' : d.severity === 'medium' ? 'warn' : undefined) : undefined}
            label={resolved ? 'Wieder öffnen' : 'Als behoben markieren'}
            onToggle={resolved ? onReopen : onResolve}
          />
        </span>
        <button type="button" data-row-main onClick={onOpen} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pr-4 text-left outline-none">
          <span className="hidden sm:block">
            {d.category ? (
              <CategoryIcon category={d.category} size="sm" />
            ) : (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sunken text-ink-2">
                <Footprints className="size-4" />
              </span>
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <span data-title className={clsx('truncate text-body font-medium', resolved || d.hiddenAt ? 'text-ink-2' : 'text-ink')}>
                {d.title}
              </span>
              {d.taskId && (
                <span className="hidden shrink-0 sm:block">
                  <Badge tone="info" variant="outline" size="sm">
                    Aufgabe
                  </Badge>
                </span>
              )}
            </span>
            <span className="mt-0.5 block truncate text-meta text-ink-3">
              {where}
              {detail && (
                <>
                  <span className="text-ink-4"> · </span>
                  <span className={resolved && !d.hiddenAt ? 'text-ok' : 'text-ink-2'}>{detail}</span>
                </>
              )}
            </span>
          </span>
          {(d.photoKey || d.resolutionPhotoKey) && (
            <span className="hidden shrink-0 -space-x-2 md:flex">
              {d.photoKey && <img src={fileUrl(d.photoKey)} alt="" className="size-8 rounded-md object-cover ring-2 ring-surface" />}
              {d.resolutionPhotoKey && <img src={fileUrl(d.resolutionPhotoKey)} alt="" className="size-8 rounded-md object-cover ring-2 ring-surface" />}
            </span>
          )}
          <span className="hidden w-28 shrink-0 text-right text-meta whitespace-nowrap text-ink-3 tabular-nums sm:block">{fmtRelative(resolved ? d.resolvedAt : d.createdAt)}</span>
          <span className="hidden w-[4.75rem] shrink-0 justify-end sm:flex">
            <SeverityBadge severity={d.severity} />
          </span>
          <PriorityGlyph level={SEV_LEVEL[d.severity]} tone={sevTone} label={SEVERITIES[d.severity]} kind="Schweregrad" className="sm:hidden" />
        </button>
      </div>
    </li>
  );
}

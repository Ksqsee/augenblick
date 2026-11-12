import clsx from 'clsx';
import type { Defect } from '../../api';
import { fmtRelative } from '../../format';
import { SeverityText } from './fields';
import { rowLeadCls, StatusToggle, useSwipe } from './rows';
import { MetaLine } from './TaskRow';

/**
 * Mangelzeile (v3): Behoben-Kreis · Titel und eine graue Meta-Zeile (Ort · Objekt · Zeit) ·
 * rechts der Schweregrad als Punkt + Wort (nur „Kritisch“ in Zinnober). Fotos, Notiz und Maßnahme
 * stehen im Detail. Wischen nach rechts (Handy) öffnet „Beheben“.
 */
export function DefectRow({ d, canEdit, onOpen, onResolve, onReopen }: { d: Defect; canEdit: boolean; onOpen: () => void; onResolve: () => void; onReopen: () => void }) {
  const resolved = d.status === 'resolved';
  const editable = canEdit && !d.hiddenAt;
  const swipe = useSwipe(editable && !resolved ? onResolve : undefined, 'Beheben');
  return (
    <li data-defect={d.id} data-row-id={d.id} className="group relative overflow-hidden bg-surface before:z-[2]">
      {swipe.underlay}
      <div
        {...swipe.handlers}
        style={swipe.style}
        className={clsx(
          'relative flex touch-pan-y items-center bg-surface transition-colors hover:bg-hover has-[[data-row-main]:focus-visible]:bg-hover has-[[data-row-main]:focus-visible]:shadow-[inset_2px_0_0_var(--color-ink)]',
          !swipe.moving && 'transition-transform duration-200',
        )}
      >
        <span className={rowLeadCls}>
          <StatusToggle done={resolved} disabled={!editable} label={resolved ? 'Wieder öffnen' : 'Als behoben markieren'} onToggle={resolved ? onReopen : onResolve} />
        </span>
        <button type="button" data-row-main onClick={onOpen} className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 py-2 pr-(--row-px) pl-0.5 text-left outline-none sm:min-h-12">
          <span className="min-w-0 flex-1">
            <span data-title className={clsx('block truncate text-body', resolved || d.hiddenAt ? 'text-ink-2' : 'text-ink')}>
              {d.title}
            </span>
            <MetaLine
              parts={[
                d.code ?? 'Begehung',
                d.location,
                d.propertyName,
                d.hiddenAt ? `Ausgeblendet: ${d.hiddenReason ?? ''}` : resolved ? `behoben ${fmtRelative(d.resolvedAt)}${d.resolvedByName ? ` von ${d.resolvedByName}` : ''}` : fmtRelative(d.createdAt),
                d.taskId && !resolved && !d.hiddenAt && 'mit Aufgabe',
              ]}
            />
          </span>
          <SeverityText severity={d.severity} />
        </button>
      </div>
    </li>
  );
}

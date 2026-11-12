import clsx from 'clsx';
import { AlarmClock, ClipboardCheck, HardHat, MessageSquare } from 'lucide-react';
import { TASK_KINDS } from '../../../shared/tasks';
import type { Task } from '../../api';
import { Avatar, Button, toneText } from '../ui';
import { LabelChip } from './fields';
import { dueText, isOpenTask, KIND_ICON, TASK_PRIO } from './model';
import { PriorityGlyph, RowCheck, StatusToggle, useSwipe } from './rows';

/**
 * Aufgabenzeile: Auswahl · Erledigt-Kreis · Titel mit Typ-Symbol und Kontext · rechts Fälligkeit,
 * Zuständige und Priorität. Auf dem Handy: zwei Zeilen, Wischen nach rechts erledigt.
 */
export function TaskRow({
  t,
  canEdit,
  selected,
  selectMode,
  onSelect,
  onOpen,
  onToggleDone,
  onStart,
  starting,
}: {
  t: Task;
  canEdit: boolean;
  selected: boolean;
  selectMode: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onToggleDone: () => void;
  onStart?: () => void;
  starting?: boolean;
}) {
  const done = t.status === 'done';
  const closed = !isOpenTask(t);
  const due = closed ? { text: '' } : dueText(t.dueAt);
  const breached = !closed && t.sla?.resolveBreached;
  const KindIcon = KIND_ICON[t.kind ?? 'other'];
  const swipe = useSwipe(canEdit && !selectMode ? onToggleDone : undefined, done ? 'Wieder öffnen' : 'Erledigt', done);
  const who = t.assigneeName ?? t.subcontractorName;
  return (
    <li data-task={t.id} data-row-id={t.id} className={clsx('group relative overflow-hidden', selected ? 'bg-brand-soft/50' : 'bg-surface')}>
      {swipe.underlay}
      <div
        {...swipe.handlers}
        style={swipe.style}
        className={clsx(
          'relative flex touch-pan-y items-center transition-colors focus-within:shadow-[inset_2px_0_0_var(--color-brand)]',
          selected ? 'bg-brand-soft/50' : 'bg-surface hover:bg-hover',
          !swipe.moving && 'transition-transform duration-200',
        )}
      >
        {canEdit && <RowCheck checked={selected} onChange={onSelect} label={`„${t.title}“ auswählen`} visible={selectMode} />}
        <span className={clsx('shrink-0', canEdit ? 'pl-1.5 sm:pl-0' : 'pl-2', selectMode && 'max-sm:hidden')}>
          <StatusToggle done={done} progress={t.status === 'in_progress'} disabled={!canEdit} label={done ? 'Wieder öffnen' : 'Erledigen'} onToggle={onToggleDone} />
        </span>
        <button type="button" data-row-main onClick={onOpen} className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2 pr-4 text-left outline-none sm:min-h-12">
          <span className="min-w-0 flex-1">
            <span className="flex min-w-0 items-center gap-1.5">
              <KindIcon className="size-3.5 shrink-0 text-ink-3" aria-label={TASK_KINDS[t.kind ?? 'other']} />
              <span className={clsx('truncate text-body font-medium', closed ? 'text-ink-3 line-through decoration-ink-4' : 'text-ink')}>{t.title}</span>
              {!!t.labels?.length && (
                <span className="hidden shrink-0 items-center gap-1 md:flex">
                  {t.labels.map((l) => (
                    <LabelChip key={l} id={l} />
                  ))}
                </span>
              )}
            </span>
            <span className="mt-0.5 flex min-w-0 items-center gap-x-1.5 text-meta text-ink-3">
              {due.text && <span className={clsx('shrink-0 font-medium sm:hidden', due.tone ? toneText[due.tone] : 'text-ink-2')}>{due.text}</span>}
              {due.text && <Dot className="sm:hidden" />}
              {t.status === 'in_progress' && (
                <>
                  <span className="shrink-0 font-medium text-info">In Arbeit</span>
                  <Dot />
                </>
              )}
              {t.externalDoneAt && !closed && (
                <>
                  <span className="shrink-0 font-medium text-ok">extern erledigt</span>
                  <Dot />
                </>
              )}
              <span className="truncate">
                {[t.assetCode, t.propertyName].filter(Boolean).join(' · ') || TASK_KINDS[t.kind ?? 'other']}
              </span>
              {who ? (
                <span className="flex shrink-0 items-center gap-1 sm:hidden">
                  <Dot />
                  {t.subcontractorName && !t.assigneeName && <HardHat className="size-3" />}
                  {who.split(' ')[0]}
                </span>
              ) : (
                !closed && (
                  <span className="shrink-0 sm:hidden">
                    <Dot /> <span className="italic">ohne Zuständige</span>
                  </span>
                )
              )}
            </span>
          </span>
          <span className="hidden shrink-0 items-center gap-3 text-meta text-ink-3 sm:flex">
            {t.comments > 0 && (
              <span className="inline-flex items-center gap-1 tabular-nums" title={`${t.comments} Kommentare`}>
                <MessageSquare className="size-3.5" />
                {t.comments}
              </span>
            )}
            {breached && (
              <span title="SLA-Lösungsfrist überschritten" className="inline-flex text-bad">
                <AlarmClock className="size-3.5" aria-label="SLA-Lösungsfrist überschritten" />
              </span>
            )}
            <span className={clsx('w-24 truncate text-right tabular-nums', due.tone ? [toneText[due.tone], 'font-medium'] : 'text-ink-2')}>{closed ? '' : due.text}</span>
            <span className="grid w-6 place-items-center" title={who ?? 'Ohne Zuständige'}>
              {t.assigneeName ? (
                <Avatar name={t.assigneeName} size="sm" />
              ) : t.subcontractorName ? (
                <span className="grid size-6 place-items-center rounded-full bg-sunken text-ink-2">
                  <HardHat className="size-3.5" />
                </span>
              ) : (
                <span className="size-6 rounded-full border border-dashed border-line-strong" aria-label="Ohne Zuständige" />
              )}
            </span>
            <PriorityGlyph level={TASK_PRIO[t.priority].level} tone={TASK_PRIO[t.priority].tone} label={TASK_PRIO[t.priority].label} />
          </span>
        </button>
        {onStart && (
          <span className="mr-3 hidden sm:block">
            <Button size="sm" variant="secondary" icon={<ClipboardCheck />} loading={starting} onClick={onStart}>
              Prüfen
            </Button>
          </span>
        )}
      </div>
    </li>
  );
}

function Dot({ className }: { className?: string }) {
  return (
    <span aria-hidden className={clsx('shrink-0 text-ink-4', className)}>
      ·
    </span>
  );
}

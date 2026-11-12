import clsx from 'clsx';
import { ClipboardCheck, MessageSquare } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { TASK_KINDS } from '../../../shared/tasks';
import type { Task } from '../../api';
import { Avatar, Button } from '../ui';
import { LabelText } from './fields';
import { dueText, isOpenTask } from './model';
import { RowCheck, rowLeadCls, StatusToggle, useSwipe } from './rows';

/** Teile einer Meta-Zeile mit „ · “ verbinden (leere fallen weg). */
export function MetaLine({ parts, className }: { parts: ReactNode[]; className?: string }) {
  const items = parts.filter((x) => x != null && x !== false && x !== '');
  return (
    <span className={clsx('mt-0.5 block truncate text-meta text-ink-3', className)}>
      {items.map((x, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-ink-4"> · </span>}
          {typeof x === 'string' ? <span>{x}</span> : x}
        </Fragment>
      ))}
    </span>
  );
}

/**
 * Aufgabenzeile (v3, wie Apple-Erinnerungen): Abhak-Kreis · Titel und eine graue Meta-Zeile
 * (Kontext · Typ · „Hoch“ · Labels) · rechts das Datum (Zinnober nur bei überfällig) und die Zuständige.
 * Auf dem Handy erledigt Wischen nach rechts.
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
  const swipe = useSwipe(canEdit && !selectMode ? onToggleDone : undefined, done ? 'Wieder öffnen' : 'Erledigt', done);
  const who = t.assigneeName ?? t.subcontractorName;
  const context = [t.assetCode, t.propertyName].filter(Boolean).join(' · ');
  return (
    <li data-task={t.id} data-row-id={t.id} className={clsx('group relative overflow-hidden before:z-[2]', selected ? 'bg-selected' : 'bg-surface')}>
      {swipe.underlay}
      <div
        {...swipe.handlers}
        style={swipe.style}
        className={clsx(
          'relative flex touch-pan-y items-center transition-colors has-[[data-row-main]:focus-visible]:bg-hover has-[[data-row-main]:focus-visible]:shadow-[inset_2px_0_0_var(--color-ink)]',
          selected ? 'bg-selected' : 'bg-surface hover:bg-hover',
          !swipe.moving && 'transition-transform duration-200',
        )}
      >
        {canEdit && <RowCheck checked={selected} onChange={onSelect} label={`„${t.title}“ auswählen`} visible={selectMode} />}
        <span className={clsx(rowLeadCls, selectMode && canEdit && 'max-sm:hidden')}>
          <StatusToggle done={done} progress={t.status === 'in_progress'} disabled={!canEdit} label={done ? 'Wieder öffnen' : 'Erledigen'} onToggle={onToggleDone} />
        </span>
        <button
          type="button"
          data-row-main
          onClick={onOpen}
          className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 py-2 pr-(--row-px) pl-0.5 text-left outline-none sm:min-h-12"
        >
          <span className="min-w-0 flex-1">
            <span className={clsx('block truncate text-body', closed ? 'text-ink-3 line-through decoration-ink-4' : 'text-ink')}>{t.title}</span>
            <MetaLine
              parts={[
                t.status === 'in_progress' && <span className="text-ink-2">In Arbeit</span>,
                t.externalDoneAt && !closed && <span className="text-ink-2">extern erledigt</span>,
                context,
                TASK_KINDS[t.kind ?? 'other'],
                t.priority === 'high' && !closed && <span className="text-ink-2">Hoch</span>,
                ...(t.labels ?? []).map((l) => <LabelText key={l} id={l} />),
              ]}
            />
          </span>
          <span className="flex shrink-0 items-center gap-3 text-meta">
            {t.comments > 0 && (
              <span className="hidden items-center gap-1 text-ink-4 tabular-nums sm:inline-flex" title={`${t.comments} Kommentare`}>
                <MessageSquare className="size-3.5" aria-hidden />
                {t.comments}
                <span className="sr-only">Kommentare</span>
              </span>
            )}
            {due.text && (
              <span className={clsx('inline-block text-right tabular-nums sm:min-w-20', due.tone === 'bad' ? 'text-shu' : due.tone === 'warn' ? 'text-ink' : 'text-ink-3')}>{due.text}</span>
            )}
            <span className="hidden w-6 place-items-center sm:grid" title={who ?? 'Ohne Zuständige'}>
              {who ? <Avatar name={who} size="sm" /> : <span className="sr-only">Ohne Zuständige</span>}
            </span>
          </span>
        </button>
        {onStart && (
          <span className="absolute inset-y-0 right-0 hidden items-center bg-hover pr-(--row-px) pl-3 opacity-0 transition-opacity pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 sm:flex">
            <Button size="sm" variant="secondary" icon={<ClipboardCheck />} loading={starting} onClick={onStart}>
              Prüfen
            </Button>
          </span>
        )}
      </div>
    </li>
  );
}

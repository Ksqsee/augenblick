// Reiter „Mängel“ des Objekts (Plan v8 Z): was bisher „Offen“ war, auf dieses Objekt gefiltert – offene Mängel ohne
// laufende Aufgabe und offene Aufgaben, erledigte einklappbar (erst beim Aufklappen geladen). Daneben die Angebotsliste
// (?ansicht=angebot). Detail wie unter „Offen“ über ?mangel= bzw. ?aufgabe=. Bausteine aus components/work und
// useTaskToggle aus pages/Tasks (nur importiert).
import { ChevronDown, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { groupByDue, urgency } from '../../../shared/tasks';
import { api, type Defect, type PropertyDetail, type Task, useAction, useDefects, useTasks } from '../../api';
import { useTaskToggle } from '../../pages/Tasks';
import { useStartInspection } from '../AssetDrawer';
import { ResolveDefectDialog } from '../DefectResolve';
import { Button, Empty, ErrorBox, Segmented, SkeletonList, Surface, useToast } from '../ui';
import { DefectPanel } from '../work/DefectPanel';
import { DefectRow } from '../work/DefectRow';
import { isOpenTask, taskFromDefect } from '../work/model';
import { listKeys, WorkGroup } from '../work/rows';
import { TaskForm } from '../work/TaskCreate';
import { TaskPanel } from '../work/TaskPanel';
import { TaskRow } from '../work/TaskRow';
import { OfferSection } from './Offer';

/** Mangel ohne laufende Aufgabe (keine oder nur eine erledigte/abgebrochene). */
const free = (d: Defect) => !d.taskId || d.taskStatus === 'done' || d.taskStatus === 'cancelled';
const startOfToday = () => new Date().setHours(0, 0, 0, 0);

export function PropertyWork({ p, canEdit, canOffer }: { p: PropertyDetail; canEdit: boolean; canOffer: boolean }) {
  const [params, setParams] = useSearchParams();
  const view = canOffer && params.get('ansicht') === 'angebot' ? 'angebot' : 'offen';
  const tasks = useTasks();
  const defects = useDefects('open', '', false);
  const [creating, setCreating] = useState(false);
  const [taskFor, setTaskFor] = useState<Defect | null>(null);
  const [resolveId, setResolveId] = useState<string | null>(null);
  const setParam = (k: 'mangel' | 'aufgabe' | 'ansicht', v: string | null) =>
    setParams(
      (q) => {
        const n = new URLSearchParams(q);
        if (k !== 'ansicht') {
          n.delete('mangel');
          n.delete('aufgabe');
        }
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );
  const mangel = params.get('mangel');
  const aufgabe = params.get('aufgabe');
  const mine = <T extends { propertyId?: string | null }>(x: T) => x.propertyId === p.id;
  const openTasks = (tasks.data ?? []).filter(mine).filter(isOpenTask);
  const openDefects = (defects.data ?? []).filter(mine);
  const openTask = aufgabe ? tasks.data?.find((t) => t.id === aufgabe) : undefined;

  return (
    <>
      {mangel && <DefectPanel key={mangel} id={mangel} onClose={() => setParam('mangel', null)} onTask={setTaskFor} onResolve={setResolveId} />}
      {openTask && <TaskPanel key={openTask.id} task={openTask} onClose={() => setParam('aufgabe', null)} />}
      {creating && <TaskForm initial={{ propertyId: p.id }} onClose={() => setCreating(false)} onCreated={(id) => setParam('aufgabe', id)} />}
      {taskFor && <TaskForm initial={taskFromDefect(taskFor)} onClose={() => setTaskFor(null)} />}
      {resolveId && <ResolveDefectDialog defectId={resolveId} onClose={() => setResolveId(null)} />}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {canOffer ? (
          <Segmented
            value={view}
            onChange={(v) => setParam('ansicht', v === 'angebot' ? 'angebot' : null)}
            options={[
              { value: 'offen', label: 'Offen', count: tasks.data && defects.data ? openTasks.length + openDefects.filter(free).length || undefined : undefined },
              { value: 'angebot', label: 'Angebotsliste' },
            ]}
          />
        ) : (
          <span />
        )}
        {canEdit && view === 'offen' && (
          <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setCreating(true)}>
            Neue Aufgabe
          </Button>
        )}
      </div>
      {view === 'angebot' ? (
        <Surface data-detail-surface>
          <OfferSection p={p} />
        </Surface>
      ) : (
        <OpenList
          p={p}
          canEdit={canEdit}
          tasks={tasks}
          defects={defects}
          onDefect={(id) => setParam('mangel', id)}
          onTask={(id) => setParam('aufgabe', id)}
          onResolve={setResolveId}
        />
      )}
    </>
  );
}

function OpenList({
  p,
  canEdit,
  tasks,
  defects,
  onDefect,
  onTask,
  onResolve,
}: {
  p: PropertyDetail;
  canEdit: boolean;
  tasks: ReturnType<typeof useTasks>;
  defects: ReturnType<typeof useDefects>;
  onDefect: (id: string) => void;
  onTask: (id: string) => void;
  onResolve: (id: string) => void;
}) {
  const [showDone, setShowDone] = useState(false);
  const toast = useToast();
  const start = useStartInspection();
  const toggle = useTaskToggle();
  const reopen = useAction(
    (id: string) => api(`/defects/${id}`, { method: 'PATCH', body: { status: 'open' } }),
    () => toast('Wieder geöffnet'),
  );
  if (tasks.isLoading || defects.isLoading)
    return (
      <Surface>
        <SkeletonList rows={5} className="shadow-none" />
      </Surface>
    );
  if (tasks.error || defects.error) return <ErrorBox error={tasks.error ?? defects.error} onRetry={() => (tasks.refetch(), defects.refetch())} />;

  const now = Date.now();
  const today = startOfToday();
  const mine = <T extends { propertyId?: string | null }>(x: T) => x.propertyId === p.id;
  const allTasks = (tasks.data ?? []).filter(mine);
  const ds = (defects.data ?? []).filter(mine).filter(free);
  const ts = allTasks.filter(isOpenTask);
  const urgent = ds.filter((d) => d.severity === 'critical' || d.severity === 'high').sort((a, b) => urgency({ kind: 'defect', level: b.severity, at: b.createdAt }, now) - urgency({ kind: 'defect', level: a.severity, at: a.createdAt }, now));
  const minor = ds.filter((d) => d.severity !== 'critical' && d.severity !== 'high').sort((a, b) => a.createdAt - b.createdAt);
  const overdue = ts.filter((t) => t.dueAt && t.dueAt < today).sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0));
  const later = groupByDue(
    ts.filter((t) => !t.dueAt || t.dueAt >= today),
    now,
  ).map((g) => ({ ...g, items: [...g.items].sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0)) }));
  const doneTasks = allTasks.filter((t) => !isOpenTask(t));
  const total = ds.length + ts.length;

  const defectRow = (d: Defect) => <DefectRow key={d.id} d={d} canEdit={canEdit} onOpen={() => onDefect(d.id)} onResolve={() => onResolve(d.id)} onReopen={() => reopen.mutate(d.id)} />;
  const taskRow = (t: Task) => (
    <TaskRow
      key={t.id}
      t={t}
      canEdit={canEdit}
      selected={false}
      selectMode={false}
      onSelect={() => {}}
      onOpen={() => onTask(t.id)}
      onToggleDone={() => toggle.onToggle(t)}
      onStart={t.kind === 'inspection' && t.assetId && canEdit ? () => start.mutate({ assetId: t.assetId!, taskId: t.id }) : undefined}
      starting={start.isPending && start.variables === t.assetId}
    />
  );
  return (
    <Surface data-detail-surface onKeyDown={listKeys()} aria-label="Offene Mängel und Aufgaben des Objekts">
      {toggle.dialog}
      {total === 0 && <Empty title="Nichts offen." text="Mängel aus Prüfungen und Begehungen dieses Objekts erscheinen hier, ebenso Aufgaben zum Objekt." />}
      {urgent.length > 0 && (
        <WorkGroup label="Schwere Mängel ohne Aufgabe" count={urgent.length}>
          {urgent.map(defectRow)}
        </WorkGroup>
      )}
      {overdue.length > 0 && (
        <WorkGroup label="Überfällige Aufgaben" count={overdue.length}>
          {overdue.map(taskRow)}
        </WorkGroup>
      )}
      {minor.length > 0 && (
        <WorkGroup label="Mängel ohne Aufgabe" count={minor.length}>
          {minor.map(defectRow)}
        </WorkGroup>
      )}
      {later.map((g) => (
        <WorkGroup key={g.key} label={g.label} count={g.items.length}>
          {g.items.map(taskRow)}
        </WorkGroup>
      ))}
      <DoneGroup p={p} open={showDone} onToggle={() => setShowDone(!showDone)} doneTasks={doneTasks} defectRow={defectRow} taskRow={taskRow} />
    </Surface>
  );
}

/** Erledigtes – eingeklappt; behobene Mängel werden erst beim Aufklappen geladen. */
function DoneGroup({
  p,
  open,
  onToggle,
  doneTasks,
  defectRow,
  taskRow,
}: {
  p: PropertyDetail;
  open: boolean;
  onToggle: () => void;
  doneTasks: Task[];
  defectRow: (d: Defect) => React.ReactNode;
  taskRow: (t: Task) => React.ReactNode;
}) {
  return (
    <section className="border-t border-line first:border-t-0" aria-label="Erledigt">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-11 w-full items-center gap-2 px-(--row-px) py-3 text-left text-meta font-medium text-ink-3 hover:text-ink-2"
      >
        <ChevronDown className={open ? 'size-4 rotate-180 transition-transform' : 'size-4 transition-transform'} />
        Erledigt
      </button>
      {open && <DoneList p={p} doneTasks={doneTasks} defectRow={defectRow} taskRow={taskRow} />}
    </section>
  );
}

function DoneList({ p, doneTasks, defectRow, taskRow }: { p: PropertyDetail; doneTasks: Task[]; defectRow: (d: Defect) => React.ReactNode; taskRow: (t: Task) => React.ReactNode }) {
  const resolved = useDefects('resolved', '', false);
  if (resolved.isLoading) return <SkeletonList rows={3} className="shadow-none" />;
  if (resolved.error) return <ErrorBox error={resolved.error} onRetry={() => resolved.refetch()} className="mx-(--row-px) mb-3" />;
  const ds = (resolved.data ?? []).filter((d) => d.propertyId === p.id).sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
  const ts = [...doneTasks].sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0));
  if (!ds.length && !ts.length) return <p className="px-(--row-px) pb-4 text-body text-ink-2">Noch nichts erledigt.</p>;
  return (
    <>
      {ds.length > 0 && (
        <WorkGroup label="Behobene Mängel" count={ds.length}>
          {ds.slice(0, 50).map(defectRow)}
        </WorkGroup>
      )}
      {ts.length > 0 && (
        <WorkGroup label="Erledigte Aufgaben" count={ts.length}>
          {ts.slice(0, 50).map(taskRow)}
        </WorkGroup>
      )}
    </>
  );
}

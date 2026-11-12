// „Offen“ (docs/plan/v4.md 5): eine Arbeitsliste aus Mängeln und Aufgaben. Umschalter Alle · Mängel · Aufgaben (?art=).
// „Alle“ zeigt, was offen ist, nach Dringlichkeit: Überfälliges und schwere Mängel ohne Aufgabe zuerst, dann die übrigen
// Mängel ohne Aufgabe, dann die Aufgaben nach Fälligkeit. Ein Mangel mit offener Aufgabe steht nur einmal da – als Aufgabe.
// Detail über die URL: ?mangel=… bzw. ?aufgabe=… (alte Links /maengel?id=… und /aufgaben?id=… leiten hierher um).
import { Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { groupByDue, urgency } from '../../shared/tasks';
import { type Defect, type Task, useDefects, useMe, useTasks } from '../api';
import { useStartInspection } from '../components/AssetDrawer';
import { ResolveDefectDialog } from '../components/DefectResolve';
import { Button, Empty, ErrorBox, Kbd, PageHeader, SearchField, SkeletonList, Surface, Tabs, useUrlTab } from '../components/ui';
import { DefectPanel } from '../components/work/DefectPanel';
import { DefectRow } from '../components/work/DefectRow';
import { isOpenTask, taskFromDefect, typing } from '../components/work/model';
import { listKeys, TextAction, WorkGroup } from '../components/work/rows';
import { TaskForm } from '../components/work/TaskCreate';
import { TaskPanel } from '../components/work/TaskPanel';
import { TaskRow } from '../components/work/TaskRow';
import { DefectsView } from './Defects';
import { TasksView, useTaskToggle } from './Tasks';

type Art = 'alle' | 'maengel' | 'aufgaben';
const ARTS: Art[] = ['alle', 'maengel', 'aufgaben'];

/** Mangel ohne laufende Aufgabe (keine oder nur eine erledigte/abgebrochene). */
const free = (d: Defect) => !d.taskId || d.taskStatus === 'done' || d.taskStatus === 'cancelled';
const startOfToday = () => new Date().setHours(0, 0, 0, 0);

export function OffenPage() {
  const [params, setParams] = useSearchParams();
  const [art, setArt] = useUrlTab<Art>('art', 'alle', ARTS);
  const { data: me } = useMe();
  const canEdit = me?.user.role !== 'viewer';
  const tasks = useTasks();
  const defects = useDefects('open', '', false);
  const [creating, setCreating] = useState(false);
  const [taskFor, setTaskFor] = useState<Defect | null>(null);
  const [resolveId, setResolveId] = useState<string | null>(null);

  const setParam = (k: 'mangel' | 'aufgabe', v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.delete('mangel');
        n.delete('aufgabe');
        if (v) n.set(k, v);
        return n;
      },
      { replace: true },
    );
  const mangel = params.get('mangel');
  const aufgabe = params.get('aufgabe');
  const openTask = aufgabe ? tasks.data?.find((t) => t.id === aufgabe) : undefined;

  // C = neue Aufgabe (aus jeder Ansicht)
  useEffect(() => {
    if (!canEdit) return;
    const h = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"]')) return;
      if (e.key === 'c') {
        e.preventDefault();
        setCreating(true);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [canEdit]);

  const openTasks = (tasks.data ?? []).filter(isOpenTask);
  const openDefects = defects.data ?? [];
  const freeDefects = openDefects.filter(free);
  const overdue = openTasks.some((t) => t.dueAt && t.dueAt < startOfToday());

  return (
    <>
      <PageHeader
        title="Offen"
        subtitle="Mängel und Aufgaben, das Dringendste zuerst"
        actions={
          canEdit && (
            <Button icon={<Plus />} onClick={() => setCreating(true)} title="Neue Aufgabe (C)">
              Neue Aufgabe
            </Button>
          )
        }
      />
      {/* Reihenfolge: Dialoge nach dem Detail, damit sie darüber liegen */}
      {mangel && <DefectPanel key={mangel} id={mangel} onClose={() => setParam('mangel', null)} onTask={setTaskFor} onResolve={setResolveId} />}
      {openTask && <TaskPanel key={openTask.id} task={openTask} onClose={() => setParam('aufgabe', null)} />}
      {creating && <TaskForm onClose={() => setCreating(false)} onCreated={(id) => setParam('aufgabe', id)} />}
      {taskFor && <TaskForm initial={taskFromDefect(taskFor)} onClose={() => setTaskFor(null)} />}
      {resolveId && <ResolveDefectDialog defectId={resolveId} onClose={() => setResolveId(null)} />}
      <Tabs
        className="mb-5"
        value={art}
        onChange={setArt}
        tabs={[
          { value: 'alle', label: 'Alle', count: tasks.data && defects.data ? openTasks.length + freeDefects.length : undefined, tone: overdue ? 'bad' : undefined },
          { value: 'maengel', label: 'Mängel', count: defects.data?.length },
          { value: 'aufgaben', label: 'Aufgaben', count: tasks.data ? openTasks.length : undefined },
        ]}
      />
      {art === 'alle' && <AllOpen canEdit={canEdit} onDefect={(id) => setParam('mangel', id)} onTask={(id) => setParam('aufgabe', id)} onResolve={setResolveId} onCreate={() => setCreating(true)} />}
      {art === 'maengel' && <DefectsView canEdit={canEdit} onOpen={(id) => setParam('mangel', id)} onResolve={setResolveId} />}
      {art === 'aufgaben' && <TasksView canEdit={canEdit} onOpen={(id) => setParam('aufgabe', id)} onCreate={() => setCreating(true)} />}
    </>
  );
}

type Entry = { kind: 'defect'; d: Defect; u: number } | { kind: 'task'; t: Task; u: number };

/** „Alle“: offene Mängel ohne Aufgabe und offene Aufgaben in einer Liste, nach Dringlichkeit gruppiert. */
function AllOpen({
  canEdit,
  onDefect,
  onTask,
  onResolve,
  onCreate,
}: {
  canEdit: boolean;
  onDefect: (id: string) => void;
  onTask: (id: string) => void;
  onResolve: (id: string) => void;
  onCreate: () => void;
}) {
  const tasks = useTasks();
  const defects = useDefects('open', '', false);
  const [q, setQ] = useState('');
  const { onToggle, dialog } = useTaskToggle();
  const start = useStartInspection();
  if (tasks.isLoading || defects.isLoading) return <SkeletonList rows={6} />;
  if (tasks.error || defects.error) return <ErrorBox error={tasks.error ?? defects.error} onRetry={() => (tasks.refetch(), defects.refetch())} />;

  const now = Date.now();
  const needle = q.trim().toLowerCase();
  const hit = (xs: (string | null | undefined)[]) => !needle || xs.some((x) => x?.toLowerCase().includes(needle));
  const ds = (defects.data ?? []).filter(free).filter((d) => hit([d.title, d.code, d.location, d.buildingName, d.propertyName, d.note, d.measure]));
  const ts = (tasks.data ?? []).filter(isOpenTask).filter((t) => hit([t.title, t.assetCode, t.propertyName, t.assigneeName, t.subcontractorName, t.description]));
  const today = startOfToday();

  // Dringend: kritische/schwere Mängel ohne Aufgabe und überfällige Aufgaben – gemeinsam nach Dringlichkeit
  const urgent: Entry[] = [
    ...ds.filter((d) => d.severity === 'critical' || d.severity === 'high').map((d) => ({ kind: 'defect' as const, d, u: urgency({ kind: 'defect', level: d.severity, at: d.createdAt }, now) })),
    ...ts.filter((t) => t.dueAt && t.dueAt < today).map((t) => ({ kind: 'task' as const, t, u: urgency({ kind: 'task', level: t.priority, at: t.dueAt! }, now) })),
  ].sort((a, b) => b.u - a.u);
  const minor = ds.filter((d) => d.severity !== 'critical' && d.severity !== 'high').sort((a, b) => a.createdAt - b.createdAt);
  const later = groupByDue(
    ts.filter((t) => !t.dueAt || t.dueAt >= today),
    now,
  ).map((g) => ({ ...g, items: [...g.items].sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0)) }));

  const total = urgent.length + minor.length + later.reduce((s, g) => s + g.items.length, 0);
  const defectRow = (d: Defect) => <DefectRow key={d.id} d={d} canEdit={canEdit} onOpen={() => onDefect(d.id)} onResolve={() => onResolve(d.id)} onReopen={() => {}} />;
  const taskRow = (t: Task) => (
    <TaskRow
      key={t.id}
      t={t}
      canEdit={canEdit}
      selected={false}
      selectMode={false}
      onSelect={() => {}}
      onOpen={() => onTask(t.id)}
      onToggleDone={() => onToggle(t)}
      onStart={t.kind === 'inspection' && t.assetId && canEdit ? () => start.mutate({ assetId: t.assetId!, taskId: t.id }) : undefined}
      starting={start.isPending && start.variables === t.assetId}
    />
  );

  return (
    <>
      {dialog}
      <div className="mb-4">
        <SearchField value={q} onChange={setQ} placeholder="Mängel und Aufgaben durchsuchen …" />
      </div>
      {total === 0 ? (
        <Surface>
          {needle ? (
            <Empty title="Nichts passt zur Suche." action={<TextAction onClick={() => setQ('')}>Suche zurücksetzen</TextAction>} />
          ) : (
            <Empty title="Nichts offen." text="Neue Mängel kommen aus Prüfungen, Begehungen oder über Erfassen." action={canEdit && <TextAction onClick={onCreate}>Neue Aufgabe</TextAction>} />
          )}
        </Surface>
      ) : (
        <>
          <Surface onKeyDown={listKeys()} aria-label="Offene Mängel und Aufgaben">
            {urgent.length > 0 && (
              <WorkGroup label="Dringend" count={urgent.length}>
                {urgent.map((e) => (e.kind === 'defect' ? defectRow(e.d) : taskRow(e.t)))}
              </WorkGroup>
            )}
            {minor.length > 0 && (
              <WorkGroup label="Weitere Mängel ohne Aufgabe" count={minor.length}>
                {minor.map(defectRow)}
              </WorkGroup>
            )}
            {later.map((g) => (
              <WorkGroup key={g.key} label={g.label} count={g.items.length}>
                {g.items.map(taskRow)}
              </WorkGroup>
            ))}
          </Surface>
          <p className="mt-3 hidden items-center gap-1.5 text-caption text-ink-3 lg:flex">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> bewegen · <Kbd>Enter</Kbd> öffnen{canEdit && <> · <Kbd>C</Kbd> neue Aufgabe</>}
          </p>
        </>
      )}
    </>
  );
}

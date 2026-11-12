// Aufgaben (Ansicht in „Offen“). Die frühere „Übersicht“ (Kennzahlen) entfällt – Kennzahlen gehören in Berichte.
import { ListChecks } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { groupByDue, TASK_KINDS, type TaskKind } from '../../shared/tasks';
import { api, type Task, useAction, useMe, useMembers, useTaskLabels, useTasks } from '../api';
import { useStartInspection } from '../components/AssetDrawer';
import { ResolveDefectDialog } from '../components/DefectResolve';
import { Button, Chip, Empty, ErrorBox, Input, Kbd, SearchField, Segmented, SkeletonList, Surface, useConfirm, useToast, useUrlTab } from '../components/ui';
import { BulkBar, barFieldCls } from '../components/work/BulkBar';
import { LABEL_DOT_NEUTRAL } from '../components/work/fields';
import { FilterMenu } from '../components/work/FilterMenu';
import { fromDateInput, isOpenTask, needsDefectQuestion, patchTask, TASK_PRIO, TASK_STATUS, typing } from '../components/work/model';
import { listKeys, TextAction, WorkGroup } from '../components/work/rows';
import { TaskRow } from '../components/work/TaskRow';

export { TaskForm } from '../components/work/TaskCreate';

// „Meine“ ist der einzige sichtbare Schalter; alles Weitere liegt im Filter-Menü (docs/plan/v3.md 5)
type Scope = '' | 'unassigned' | 'created' | 'watching';
const SCOPES: { value: Scope; label: string }[] = [
  { value: '', label: 'Alle Aufgaben' },
  { value: 'unassigned', label: 'Ohne Zuständige' },
  { value: 'created', label: 'Von mir erstellt' },
  { value: 'watching', label: 'Beobachtet' },
];
type View = 'active' | 'done';

/**
 * Erledigen per Abhak-Kreis (oder Wischen): bei einer Mängelbehebung mit offenem Mangel danach die Rückfrage,
 * ob der Mangel auch behoben ist. Liefert den Umschalter und den Dialog.
 */
export function useTaskToggle() {
  const toast = useToast();
  const [resolveFor, setResolveFor] = useState<Task | null>(null);
  const toggleDone = useAction(
    (v: { t: Task; resolveDefect: boolean }) => patchTask(v.t, { status: v.t.status === 'done' ? 'open' : 'done', resolveDefect: v.resolveDefect }),
    (_, v) => {
      toast(v.t.status === 'done' ? 'Wieder geöffnet' : 'Erledigt');
      if (v.t.status !== 'done' && !v.resolveDefect) setResolveFor(v.t);
    },
  );
  const onToggle = (t: Task) => toggleDone.mutate({ t, resolveDefect: !(t.status !== 'done' && needsDefectQuestion(t)) });
  const dialog = resolveFor?.defectId ? (
    <ResolveDefectDialog
      defectId={resolveFor.defectId}
      title="Mangel auch als behoben markieren?"
      intro={`„${resolveFor.title}“ ist erledigt. Ist damit auch der Mangel ${resolveFor.defectTitle ? `„${resolveFor.defectTitle}“ ` : ''}behoben?`}
      skipLabel="Nur Aufgabe erledigen"
      onSkip={() => setResolveFor(null)}
      onClose={() => setResolveFor(null)}
    />
  ) : null;
  return { onToggle, dialog };
}

/**
 * Aufgaben als Ansicht in „Offen“ (?art=aufgaben): Offen/Erledigt, Suche, „Meine“, Filter-Menü, Mehrfachbearbeitung.
 * Detail und „Neue Aufgabe“ liegen eine Ebene höher (OffenPage).
 */
export function TasksView({ canEdit, onOpen, onCreate }: { canEdit: boolean; onOpen: (id: string) => void; onCreate: () => void }) {
  const { data, isLoading, error, refetch } = useTasks();
  const { data: me } = useMe();
  const labels = useTaskLabels();
  const [view, setView] = useUrlTab<View>('ansicht', 'active', ['active', 'done']);
  const [mine, setMine] = useState(false);
  const [scope, setScope] = useState<Scope>('');
  const [kind, setKind] = useState<'' | TaskKind>('');
  const [label, setLabel] = useState('');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const start = useStartInspection();
  const { onToggle, dialog } = useTaskToggle();
  const myId = me?.user.id;

  const needle = q.trim().toLowerCase();
  const filtered = (data ?? []).filter(
    (t) =>
      (!mine || t.assigneeId === myId) &&
      (scope !== 'unassigned' || (!t.assigneeId && !t.subcontractorId)) &&
      (scope !== 'created' || t.createdBy === myId) &&
      (scope !== 'watching' || t.watching) &&
      (!kind || t.kind === kind) &&
      (!label || t.labels?.includes(label)) &&
      (!needle || [t.title, t.assetCode, t.propertyName, t.assigneeName, t.subcontractorName, t.description].some((x) => x?.toLowerCase().includes(needle))),
  );
  const rows = filtered.filter((t) => (view === 'done' ? !isOpenTask(t) : isOpenTask(t)));
  const groups =
    view === 'done'
      ? [{ key: 'done', label: 'Erledigt und abgebrochen', items: [...rows].sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)) }]
      : groupByDue(rows, Date.now()).map((g) => ({ ...g, items: [...g.items].sort((a, b) => (a.dueAt ?? 0) - (b.dueAt ?? 0) || TASK_PRIO[b.priority].level - TASK_PRIO[a.priority].level) }));
  const openCount = (data ?? []).filter(isOpenTask).length;
  const sel = rows.filter((r) => selected.has(r.id));
  const menuActive = [scope, kind, label].filter(Boolean).length;
  const filtersActive = !!(mine || menuActive || needle);
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const clearSel = () => {
    setSelected(new Set());
    setSelectMode(false);
  };
  const resetMenu = () => {
    setScope('');
    setKind('');
    setLabel('');
  };
  const reset = () => {
    setMine(false);
    setScope('');
    setKind('');
    setLabel('');
    setQ('');
  };

  // Tastenkürzel: C = neue Aufgabe, / = Suche, Esc = Auswahl aufheben
  const search = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"]')) return;
      if (e.key === '/') {
        e.preventDefault();
        search.current?.querySelector('input')?.focus();
      } else if (e.key === 'Escape' && selected.size) clearSel();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [canEdit, selected.size]);

  return (
    <>
      {dialog}
      <div ref={search} className="mb-4 flex flex-wrap items-center gap-2">
        <SearchField value={q} onChange={setQ} placeholder="Aufgaben durchsuchen …" className="sm:w-64" />
        <Segmented
          value={view}
          onChange={(v) => {
            setView(v);
            clearSel();
          }}
          options={[
            { value: 'active', label: 'Offen', count: openCount },
            { value: 'done', label: 'Erledigt' },
          ]}
        />
        <Chip active={mine} onClick={() => setMine(!mine)}>
          Meine
        </Chip>
        <FilterMenu
          active={menuActive}
          onReset={resetMenu}
          groups={[
            { title: 'Zuständigkeit', label: 'Nach Zuständigkeit filtern', value: scope, onChange: (v) => setScope(v as Scope), options: SCOPES },
            {
              title: 'Typ',
              label: 'Nach Typ filtern',
              value: kind,
              onChange: (v) => setKind(v as '' | TaskKind),
              options: [{ value: '', label: 'Alle Typen' }, ...(Object.keys(TASK_KINDS) as TaskKind[]).map((k) => ({ value: k, label: TASK_KINDS[k] }))],
            },
            ...(labels.data?.length
              ? [
                  {
                    title: 'Label',
                    label: 'Nach Label filtern',
                    value: label,
                    onChange: setLabel,
                    options: [{ value: '', label: 'Alle Labels' }, ...labels.data.map((l) => ({ value: l.id, label: l.name, dot: LABEL_DOT_NEUTRAL }))],
                  },
                ]
              : []),
          ]}
        />
        {canEdit && (
          <span className="ml-auto sm:hidden">
            <Button size="sm" variant={selectMode ? 'primary' : 'ghost'} icon={<ListChecks />} onClick={() => (selectMode ? clearSel() : setSelectMode(true))}>
              {selectMode ? 'Fertig' : 'Auswählen'}
            </Button>
          </span>
        )}
      </div>
      {isLoading ? (
        <SkeletonList rows={6} />
      ) : error ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : rows.length === 0 ? (
        <Surface>
          {filtersActive ? (
            <Empty title="Keine Aufgabe passt zu Suche und Filtern." action={<TextAction onClick={reset}>Filter zurücksetzen</TextAction>} />
          ) : view === 'done' ? (
            <Empty title="Noch nichts erledigt." text="Erledigte und abgebrochene Aufgaben sammeln sich hier." />
          ) : data?.length ? (
            <Empty title="Alles erledigt." text="Neue Aufgaben entstehen aus Mängeln oder du legst sie selbst an." action={canEdit && <TextAction onClick={() => onCreate()}>Neue Aufgabe</TextAction>} />
          ) : (
            <Empty title="Noch keine Aufgaben." text="Lege eine Aufgabe an oder erzeuge sie direkt aus einem Mangel." action={canEdit && <TextAction onClick={() => onCreate()}>Neue Aufgabe</TextAction>} />
          )}
        </Surface>
      ) : (
        <>
          <Surface onKeyDown={listKeys(canEdit ? toggle : undefined)}>
            {groups.map((g) => (
              <WorkGroup
                key={g.key}
                label={g.label}
                count={g.items.length}
                select={
                  canEdit
                    ? {
                        visible: selectMode,
                        checked: g.items.every((t) => selected.has(t.id)),
                        onChange: (on) =>
                          setSelected((s) => {
                            const n = new Set(s);
                            for (const t of g.items) on ? n.add(t.id) : n.delete(t.id);
                            return n;
                          }),
                      }
                    : undefined
                }
              >
                {g.items.map((t) => (
                  <TaskRow
                    key={t.id}
                    t={t}
                    canEdit={canEdit}
                    selected={selected.has(t.id)}
                    selectMode={selectMode || selected.size > 0}
                    onSelect={() => toggle(t.id)}
                    onOpen={() => (selectMode ? toggle(t.id) : onOpen(t.id))}
                    onToggleDone={() => onToggle(t)}
                    onStart={t.kind === 'inspection' && t.assetId && canEdit && isOpenTask(t) ? () => start.mutate({ assetId: t.assetId!, taskId: t.id }) : undefined}
                    starting={start.isPending && start.variables === t.assetId}
                  />
                ))}
              </WorkGroup>
            ))}
          </Surface>
          <p className="mt-3 hidden items-center gap-1.5 text-caption text-ink-3 lg:flex">
            <Kbd>↑</Kbd>
            <Kbd>↓</Kbd> bewegen · <Kbd>Enter</Kbd> öffnen · {canEdit && (<><Kbd>X</Kbd> auswählen · <Kbd>C</Kbd> neue Aufgabe · </>)}
            <Kbd>/</Kbd> suchen
          </p>
        </>
      )}
      {canEdit && sel.length > 0 && (
        <>
          <div className="h-40 sm:h-20" aria-hidden />
          <TaskBulk tasks={sel} onDone={clearSel} />
        </>
      )}
    </>
  );
}

/** Mehrfachbearbeitung: Werte wählen, dann übernehmen. */
function TaskBulk({ tasks, onDone }: { tasks: Task[]; onDone: () => void }) {
  const members = useMembers();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [v, setV] = useState({ status: '', assigneeId: '', priority: '', due: '' });
  const apply = useAction(
    async () => {
      const withDefect = tasks.filter((t) => needsDefectQuestion(t)).length;
      const body: Record<string, unknown> = { ids: tasks.map((t) => t.id) };
      if (v.status) body.status = v.status;
      if (v.assigneeId) body.assigneeId = v.assigneeId === '-' ? null : v.assigneeId;
      if (v.priority) body.priority = v.priority;
      if (v.due) body.dueAt = fromDateInput(v.due);
      if (v.status === 'done' && withDefect)
        body.resolveDefects = await confirm({
          title: withDefect === 1 ? 'Verknüpften Mangel auch beheben?' : `${withDefect} verknüpfte Mängel auch beheben?`,
          text: 'Die Mängel werden ohne Notiz und Foto als behoben markiert.',
          confirmLabel: 'Ja, beheben',
        });
      return api<{ updated: number }>('/tasks/bulk', { body });
    },
    (r) => {
      toast(`${r.updated} ${r.updated === 1 ? 'Aufgabe' : 'Aufgaben'} geändert`);
      setV({ status: '', assigneeId: '', priority: '', due: '' });
      onDone();
    },
  );
  const nothing = !v.status && !v.assigneeId && !v.priority && !v.due;
  return (
    <BulkBar count={tasks.length} onClear={onDone} error={apply.error ? <ErrorBox error={apply.error} /> : undefined}>
      <select aria-label="Status für Auswahl" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} className={`${barFieldCls} sm:w-28`}>
        <option value="">Status</option>
        {Object.entries(TASK_STATUS).map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
      <select aria-label="Zuständig für Auswahl" value={v.assigneeId} onChange={(e) => setV({ ...v, assigneeId: e.target.value })} className={`${barFieldCls} sm:w-36`}>
        <option value="">Zuständig</option>
        <option value="-">Niemand</option>
        {members.data?.members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </select>
      <select aria-label="Priorität für Auswahl" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })} className={`${barFieldCls} sm:w-28`}>
        <option value="">Priorität</option>
        {Object.entries(TASK_PRIO).map(([k, p]) => (
          <option key={k} value={k}>
            {p.label}
          </option>
        ))}
      </select>
      <Input aria-label="Fällig am für Auswahl" type="date" value={v.due} onChange={(e) => setV({ ...v, due: e.target.value })} className="!h-10 !text-meta sm:!h-8 sm:!w-36" />
      <Button size="sm" className="col-span-2 max-sm:!h-11" disabled={nothing} loading={apply.isPending} onClick={() => apply.mutate(undefined)}>
        Übernehmen
      </Button>
      {confirmEl}
    </BulkBar>
  );
}

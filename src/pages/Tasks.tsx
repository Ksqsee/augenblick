import { CheckCheck, ListChecks, ListTodo, Plus, SearchX } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { DUE_GROUPS, groupByDue, TASK_KINDS, type TaskKind } from '../../shared/tasks';
import { api, type Task, useAction, useMe, useMembers, useTaskLabels, useTasks, useTaskStats } from '../api';
import { useStartInspection } from '../components/AssetDrawer';
import { ResolveDefectDialog } from '../components/DefectResolve';
import { Button, Card, Chip, Empty, ErrorBox, Input, Kbd, PageHeader, SearchField, SkeletonList, StatTile, Tabs, useConfirm, useToast, useUrlTab } from '../components/ui';
import { BulkBar, barFieldCls } from '../components/work/BulkBar';
import { fromDateInput, isOpenTask, needsDefectQuestion, patchTask, TASK_PRIO, TASK_STATUS, typing } from '../components/work/model';
import { listKeys, WorkGroup } from '../components/work/rows';
import { TaskForm } from '../components/work/TaskCreate';
import { TaskPanel } from '../components/work/TaskPanel';
import { TaskRow } from '../components/work/TaskRow';
import type { Tone } from '../format';

export { TaskForm } from '../components/work/TaskCreate';

type Quick = '' | 'mine' | 'unassigned' | 'created' | 'watching';
const QUICK: { value: Exclude<Quick, ''>; label: string }[] = [
  { value: 'mine', label: 'Meine' },
  { value: 'unassigned', label: 'Ohne Zuständige' },
  { value: 'created', label: 'Von mir erstellt' },
  { value: 'watching', label: 'Beobachtet' },
];
const GROUP_TONE: Partial<Record<keyof typeof DUE_GROUPS, Tone>> = { overdue: 'bad', today: 'warn' };
type View = 'active' | 'done' | 'stats';

export function TasksPage() {
  const { data, isLoading, error, refetch } = useTasks();
  const { data: me } = useMe();
  const labels = useTaskLabels();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useUrlTab<View>('ansicht', 'active', ['active', 'done', 'stats']);
  const [quick, setQuick] = useState<Quick>('');
  const [kind, setKind] = useState<'' | TaskKind>('');
  const [label, setLabel] = useState('');
  const [q, setQ] = useState('');
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [resolveFor, setResolveFor] = useState<Task | null>(null);
  const toast = useToast();
  const start = useStartInspection();
  const canEdit = me?.user.role !== 'viewer';
  const myId = me?.user.id;

  // Detail über die URL (?id=…): Direktlinks aus Benachrichtigungen, Zurück-Taste schließt
  const openId = params.get('id');
  const setOpen = (id: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (id) n.set('id', id);
        else n.delete('id');
        return n;
      },
      { replace: true },
    );
  const open = openId ? data?.find((t) => t.id === openId) : undefined;

  const toggleDone = useAction(
    (v: { t: Task; resolveDefect: boolean }) => patchTask(v.t, { status: v.t.status === 'done' ? 'open' : 'done', resolveDefect: v.resolveDefect }),
    (_, v) => {
      toast(v.t.status === 'done' ? 'Wieder geöffnet' : 'Erledigt');
      if (v.t.status !== 'done' && !v.resolveDefect) setResolveFor(v.t);
    },
  );
  const onToggle = (t: Task) => toggleDone.mutate({ t, resolveDefect: !(t.status !== 'done' && needsDefectQuestion(t)) });

  const needle = q.trim().toLowerCase();
  const filtered = (data ?? []).filter(
    (t) =>
      (quick !== 'mine' || t.assigneeId === myId) &&
      (quick !== 'unassigned' || (!t.assigneeId && !t.subcontractorId)) &&
      (quick !== 'created' || t.createdBy === myId) &&
      (quick !== 'watching' || t.watching) &&
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
  const overdueCount = (data ?? []).filter((t) => isOpenTask(t) && t.dueAt && t.dueAt < new Date().setHours(0, 0, 0, 0)).length;
  const sel = rows.filter((r) => selected.has(r.id));
  const filtersActive = !!(quick || kind || label || needle);
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
  const reset = () => {
    setQuick('');
    setKind('');
    setLabel('');
    setQ('');
  };

  // Tastenkürzel: C = neue Aufgabe, / = Suche, Esc = Auswahl aufheben
  const search = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (typing(e) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role="dialog"]')) return;
      if (e.key === 'c' && canEdit) {
        e.preventDefault();
        setCreating(true);
      } else if (e.key === '/') {
        e.preventDefault();
        search.current?.querySelector('input')?.focus();
      } else if (e.key === 'Escape' && selected.size) clearSel();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [canEdit, selected.size]);

  return (
    <>
      <PageHeader
        title="Aufgaben"
        subtitle="Prüfaufträge, Mängelbehebung und sonstige To-dos im Team"
        actions={
          canEdit && (
            <Button icon={<Plus />} onClick={() => setCreating(true)} title="Neue Aufgabe (C)">
              Neue Aufgabe
            </Button>
          )
        }
      />
      {creating && <TaskForm onClose={() => setCreating(false)} onCreated={(id) => setOpen(id)} />}
      {open && <TaskPanel key={open.id} task={open} onClose={() => setOpen(null)} />}
      {resolveFor?.defectId && (
        <ResolveDefectDialog
          defectId={resolveFor.defectId}
          title="Mangel auch als behoben markieren?"
          intro={`„${resolveFor.title}“ ist erledigt. Ist damit auch der Mangel ${resolveFor.defectTitle ? `„${resolveFor.defectTitle}“ ` : ''}behoben?`}
          skipLabel="Nur Aufgabe erledigen"
          onSkip={() => setResolveFor(null)}
          onClose={() => setResolveFor(null)}
        />
      )}
      <Tabs
        className="mb-5"
        value={view}
        onChange={(v) => {
          setView(v);
          clearSel();
        }}
        tabs={[
          { value: 'active', label: 'Offen', count: openCount, tone: overdueCount ? 'bad' : undefined },
          { value: 'done', label: 'Erledigt' },
          { value: 'stats', label: 'Übersicht' },
        ]}
      />
      {view === 'stats' ? (
        <TaskStatsView />
      ) : (
        <>
          <div ref={search} className="mb-4 flex flex-col gap-2.5 lg:flex-row lg:items-center">
            <div className="flex items-center gap-2 lg:w-64 lg:shrink-0">
              <SearchField value={q} onChange={setQ} placeholder="Aufgaben durchsuchen …" />
              {canEdit && (
                <span className="shrink-0 sm:hidden">
                  <Button variant={selectMode ? 'primary' : 'secondary'} icon={<ListChecks />} onClick={() => (selectMode ? clearSel() : setSelectMode(true))}>
                    {selectMode ? 'Fertig' : 'Auswählen'}
                  </Button>
                </span>
              )}
            </div>
            <div className="no-scrollbar -mx-4 flex min-w-0 items-center gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0 lg:flex-1 lg:flex-nowrap">
              {QUICK.map((x) => (
                <Chip key={x.value} active={quick === x.value} onClick={() => setQuick(quick === x.value ? '' : x.value)}>
                  {x.label}
                </Chip>
              ))}
              <span className="mx-1 h-5 w-px shrink-0 bg-line" aria-hidden />
              <select value={kind} onChange={(e) => setKind(e.target.value as '' | TaskKind)} className={`${barFieldCls} h-9 shrink-0 sm:h-8`} aria-label="Nach Typ filtern">
                <option value="">Alle Typen</option>
                {(Object.keys(TASK_KINDS) as TaskKind[]).map((k) => (
                  <option key={k} value={k}>
                    {TASK_KINDS[k]}
                  </option>
                ))}
              </select>
              {!!labels.data?.length && (
                <select value={label} onChange={(e) => setLabel(e.target.value)} className={`${barFieldCls} h-9 shrink-0 sm:h-8`} aria-label="Nach Label filtern">
                  <option value="">Alle Labels</option>
                  {labels.data.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
          {isLoading ? (
            <SkeletonList rows={6} />
          ) : error ? (
            <ErrorBox error={error} onRetry={() => refetch()} />
          ) : rows.length === 0 ? (
            <Card>
              {filtersActive ? (
                <Empty icon={<SearchX />} title="Keine Treffer" text="Keine Aufgabe passt zu Suche und Filtern." action={<Button variant="secondary" onClick={reset}>Filter zurücksetzen</Button>} />
              ) : view === 'done' ? (
                <Empty icon={<CheckCheck />} title="Noch nichts erledigt" text="Erledigte und abgebrochene Aufgaben sammeln sich hier." />
              ) : data?.length ? (
                <Empty icon={<CheckCheck />} title="Alles erledigt" text="Keine offenen Aufgaben. Neue entstehen aus Mängeln oder du legst sie selbst an." action={canEdit && <Button icon={<Plus />} onClick={() => setCreating(true)}>Neue Aufgabe</Button>} />
              ) : (
                <Empty icon={<ListTodo />} title="Noch keine Aufgaben" text="Lege eine Aufgabe an oder erzeuge sie direkt aus einem Mangel." action={canEdit && <Button icon={<Plus />} onClick={() => setCreating(true)}>Neue Aufgabe</Button>} />
              )}
            </Card>
          ) : (
            <>
              <Card className="overflow-hidden" onKeyDown={listKeys(canEdit ? toggle : undefined)}>
                {groups.map((g) => (
                  <WorkGroup
                    key={g.key}
                    label={g.label}
                    count={g.items.length}
                    tone={GROUP_TONE[g.key as keyof typeof DUE_GROUPS]}
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
                        onOpen={() => (selectMode ? toggle(t.id) : setOpen(t.id))}
                        onToggleDone={() => onToggle(t)}
                        onStart={t.kind === 'inspection' && t.assetId && canEdit && isOpenTask(t) ? () => start.mutate(t.assetId!) : undefined}
                        starting={start.isPending && start.variables === t.assetId}
                      />
                    ))}
                  </WorkGroup>
                ))}
              </Card>
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

const fmtDuration = (ms: number | null) => {
  if (ms == null) return '–';
  const h = ms / 3_600_000;
  return h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} Tage`;
};

function TaskStatsView() {
  const [days, setDays] = useState(30);
  const { data, isLoading, error, refetch } = useTaskStats(days);
  if (error) return <ErrorBox error={error} onRetry={() => refetch()} />;
  if (isLoading || !data)
    return (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4" role="status" aria-label="Lädt">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="skeleton block h-28 rounded-xl" />
        ))}
      </div>
    );
  const maxLoad = Math.max(1, ...data.workload.map((w) => w.open));
  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center justify-between gap-3">
        <p className="text-meta text-ink-3">Kennzahlen für den gewählten Zeitraum</p>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))} className={barFieldCls} aria-label="Zeitraum">
          {[7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>
              Letzte {d} Tage
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Offen" value={data.backlog.open} tone={data.backlog.overdue ? 'bad' : undefined} hint={`${data.backlog.overdue} überfällig`} />
        <StatTile label="Erstellt / erledigt" value={`${data.throughput.created} / ${data.throughput.closed}`} hint="im Zeitraum" />
        <StatTile label="Ø Lösungszeit" value={fmtDuration(data.resolution.avgResolutionMs)} hint={`Ø Reaktion ${fmtDuration(data.resolution.avgResponseMs)}`} />
        <StatTile
          label="SLA eingehalten"
          value={data.sla.compliancePct == null ? '–' : `${data.sla.compliancePct} %`}
          tone={data.sla.compliancePct != null ? (data.sla.compliancePct >= 90 ? 'ok' : 'bad') : undefined}
          hint={`${data.sla.breached} von ${data.sla.total} verletzt`}
        />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2.5 text-title font-semibold">Offen nach Priorität</h2>
          <Card className="flex flex-col gap-3.5 p-4 sm:p-5">
            {(['high', 'medium', 'low'] as const).map((p) => (
              <Bar key={p} label={TASK_PRIO[p].label} value={data.backlog.byPriority[p]} max={Math.max(1, data.backlog.open)} cls={p === 'high' ? 'bg-bad' : p === 'medium' ? 'bg-warn' : 'bg-ink-3'} />
            ))}
          </Card>
        </section>
        <section>
          <h2 className="mb-2.5 text-title font-semibold">Auslastung</h2>
          <Card className="flex flex-col gap-3.5 p-4 sm:p-5">
            {data.workload.length === 0 && <p className="text-body text-ink-3">Niemand hat offene Aufgaben.</p>}
            {data.workload.map((w) => (
              <Bar key={w.name} label={w.name} value={w.open} max={maxLoad} cls="bg-ink" extra={w.overdue > 0 ? <span className="text-bad">{w.overdue} überfällig</span> : undefined} />
            ))}
          </Card>
        </section>
      </div>
    </div>
  );
}

function Bar({ label, value, max, cls, extra }: { label: string; value: number; max: number; cls: string; extra?: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-3 text-body sm:grid-cols-[9rem_minmax(0,1fr)_auto]">
      <span className="truncate text-ink-2">{label}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-sunken">
        <span className={`block h-full rounded-full ${cls}`} style={{ width: `${(value / max) * 100}%` }} />
      </span>
      <span className="text-right text-meta tabular-nums">
        <span className={value ? 'text-ink' : 'text-ink-4'}>{value}</span>
        {extra && <span className="ml-1.5 text-caption">{extra}</span>}
      </span>
    </div>
  );
}

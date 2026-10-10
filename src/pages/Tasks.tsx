import clsx from 'clsx';
import { AlarmClock, BarChart3, Calendar, Copy, HardHat, Link2, ListTodo, MessageSquare, Plus, Send, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, queryClient, type Task, useAction, useMe, useMembers, useSubcontractors, useTaskComments, useTaskLabels, useTasks, useTaskStats } from '../api';
import { COLOR_CLASSES } from '../components/CategoryIcon';
import { Badge, Button, Card, CardHeader, Empty, ErrorBox, Field, Input, Modal, PageHeader, Segmented, Select, Spinner, Textarea, useToast } from '../components/ui';
import { fmtDate, fmtDateTime, fmtRelative } from '../format';

const STATUS: Record<Task['status'], string> = { open: 'Offen', in_progress: 'In Arbeit', done: 'Erledigt', cancelled: 'Abgebrochen' };
const PRIO: Record<Task['priority'], { label: string; tone: 'bad' | 'warn' | 'muted' }> = {
  high: { label: 'Hoch', tone: 'bad' },
  medium: { label: 'Mittel', tone: 'warn' },
  low: { label: 'Niedrig', tone: 'muted' },
};

const toDateInput = (ts: number | null) => (ts ? new Date(ts).toISOString().slice(0, 10) : '');

function LabelChip({ id }: { id: string }) {
  const { data } = useTaskLabels();
  const l = data?.find((x) => x.id === id);
  if (!l) return null;
  return <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium', COLOR_CLASSES[l.color])}>{l.name}</span>;
}

export function TaskForm({ initial, onClose }: { initial?: Partial<Task>; onClose: () => void }) {
  const toast = useToast();
  const members = useMembers();
  const subs = useSubcontractors();
  const labels = useTaskLabels();
  const { data: me } = useMe();
  const [f, setF] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    status: initial?.status ?? 'open',
    priority: initial?.priority ?? 'medium',
    due: toDateInput(initial?.dueAt ?? null),
    assigneeId: initial?.assigneeId ?? '',
    subcontractorId: initial?.subcontractorId ?? '',
    labels: initial?.labels ?? [],
  });
  const [shareToken, setShareToken] = useState(initial?.shareToken ?? null);
  const share = useAction(() => api<{ token: string }>(`/tasks/${initial!.id}/share`, { method: 'POST' }), (r) => setShareToken(r.token));
  const unshare = useAction(() => api(`/tasks/${initial!.id}/share`, { method: 'DELETE' }), () => setShareToken(null));
  const shareUrl = shareToken ? `${window.location.origin}/extern/${shareToken}` : '';
  const save = useAction(
    () => {
      const body = {
        title: f.title,
        description: f.description,
        status: f.status,
        priority: f.priority,
        dueAt: f.due ? new Date(`${f.due}T12:00:00`).getTime() : null,
        assigneeId: f.assigneeId || null,
        subcontractorId: f.subcontractorId || null,
        assetId: initial?.assetId ?? null,
        defectId: initial?.defectId ?? null,
        propertyId: initial?.propertyId ?? null,
        labels: f.labels,
      };
      return initial?.id ? api(`/tasks/${initial.id}`, { method: 'PATCH', body }) : api('/tasks', { body });
    },
    () => {
      toast(initial?.id ? 'Aufgabe gespeichert' : 'Aufgabe angelegt');
      onClose();
    },
  );
  const del = useAction(
    () => api(`/tasks/${initial!.id}`, { method: 'DELETE' }),
    () => {
      toast('Aufgabe gelöscht');
      onClose();
    },
  );
  const isAdmin = me && ['owner', 'admin'].includes(me.user.role);
  return (
    <Modal
      wide
      title={initial?.id ? 'Aufgabe bearbeiten' : 'Neue Aufgabe'}
      onClose={onClose}
      footer={
        <>
          {initial?.id && isAdmin && (
            <Button variant="ghost" className="mr-auto text-bad" icon={<Trash2 className="size-4" />} onClick={() => confirm('Aufgabe löschen?') && del.mutate(undefined)}>
              Löschen
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button form="task-form" loading={save.isPending}>
            Speichern
          </Button>
        </>
      }
    >
      <form
        id="task-form"
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        {save.error && (
          <div className="sm:col-span-2">
            <ErrorBox error={save.error} />
          </div>
        )}
        {initial?.sla && initial.status !== 'done' && (
          <div className="flex flex-wrap gap-2 text-xs sm:col-span-2">
            <Badge tone={initial.sla.responseBreached ? 'bad' : 'muted'}>Reaktion bis {fmtDateTime(initial.sla.responseDue)}</Badge>
            <Badge tone={initial.sla.resolveBreached ? 'bad' : 'muted'}>Lösung bis {fmtDateTime(initial.sla.resolveDue)}</Badge>
          </div>
        )}
        <Field label="Titel" className="sm:col-span-2">
          {(id) => <Input id={id} required autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}
        </Field>
        <Field label="Beschreibung" className="sm:col-span-2">
          {(id) => <Textarea id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}
        </Field>
        <Field label="Status">
          {(id) => (
            <Select id={id} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Task['status'] })}>
              {Object.entries(STATUS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Priorität">
          {(id) => (
            <Select id={id} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Task['priority'] })}>
              {Object.entries(PRIO).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Fällig am" hint={!initial?.id ? 'Leer = Lösungsfrist laut SLA' : undefined}>
          {(id) => <Input id={id} type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />}
        </Field>
        <Field label="Zuständig">
          {(id) => (
            <Select id={id} value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
              <option value="">Niemand</option>
              {members.data?.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Subunternehmer" className="sm:col-span-2">
          {(id) => (
            <Select id={id} value={f.subcontractorId} onChange={(e) => setF({ ...f, subcontractorId: e.target.value })}>
              <option value="">Keiner</option>
              {subs.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.company}
                  {s.trade ? ` · ${s.trade}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {!!labels.data?.length && (
          <div className="sm:col-span-2">
            <p className="mb-1.5 text-[13px] font-medium text-ink-2">Labels</p>
            <div className="flex flex-wrap gap-1.5">
              {labels.data.map((l) => {
                const on = f.labels.includes(l.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setF({ ...f, labels: on ? f.labels.filter((x) => x !== l.id) : [...f.labels, l.id] })}
                    className={clsx('rounded-full px-2.5 py-1 text-xs font-medium transition', on ? COLOR_CLASSES[l.color] : 'bg-sunken text-ink-3', on && 'ring-1 ring-current')}
                  >
                    {l.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {initial?.id && f.subcontractorId && f.subcontractorId === initial.subcontractorId && (
          <div className="rounded-lg border border-line bg-sunken/50 p-3 sm:col-span-2">
            <p className="mb-2 flex items-center gap-2 text-[13px] font-medium">
              <Link2 className="size-4 text-ink-3" /> Link für den Subunternehmer
            </p>
            {shareToken ? (
              <div className="flex gap-2">
                <Input readOnly value={shareUrl} onFocus={(e) => e.target.select()} />
                <Button
                  type="button"
                  variant="secondary"
                  aria-label="Kopieren"
                  onClick={async () => {
                    await navigator.clipboard.writeText(shareUrl);
                    toast('Link kopiert');
                  }}
                >
                  <Copy className="size-4" />
                </Button>
                <Button type="button" variant="ghost" onClick={() => unshare.mutate(undefined)}>
                  Sperren
                </Button>
              </div>
            ) : (
              <Button type="button" size="sm" variant="secondary" loading={share.isPending} onClick={() => share.mutate(undefined)}>
                Link erzeugen
              </Button>
            )}
            <p className="mt-2 text-xs text-ink-3">Über den Link sieht die Firma nur diese Aufgabe und kann sie als erledigt melden – ohne Konto.</p>
          </div>
        )}
        {initial?.defectId && <p className="text-xs text-ink-3 sm:col-span-2">Verknüpft mit einem Mangel – wird beim Erledigen automatisch als behoben markiert.</p>}
      </form>
      {initial?.id && <Comments taskId={initial.id} />}
    </Modal>
  );
}

function Comments({ taskId }: { taskId: string }) {
  const { data } = useTaskComments(taskId);
  const [body, setBody] = useState('');
  const add = useAction(() => api(`/tasks/${taskId}/comments`, { body: { body } }), () => setBody(''));
  return (
    <div className="mt-6 border-t border-line pt-4">
      <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink-2">
        <MessageSquare className="size-4" /> Verlauf
      </p>
      <ul className="mb-3 flex flex-col gap-3">
        {data?.map((c) => (
          <li key={c.id} className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-sunken text-[11px] font-semibold text-ink-2">
              {c.authorName
                .split(' ')
                .map((p) => p[0])
                .slice(0, 2)
                .join('')}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-3">
                <span className="font-medium text-ink-2">{c.authorName}</span> · {fmtRelative(c.createdAt)}
              </p>
              <p className="text-sm whitespace-pre-line">{c.body}</p>
            </div>
          </li>
        ))}
        {!data?.length && <li className="text-sm text-ink-3">Noch keine Kommentare.</li>}
      </ul>
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) add.mutate(undefined);
        }}
      >
        <Input placeholder="Kommentar schreiben …" value={body} onChange={(e) => setBody(e.target.value)} />
        <Button variant="secondary" loading={add.isPending} aria-label="Senden">
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}

export function TasksPage() {
  const { data, isLoading, error } = useTasks();
  const { data: me } = useMe();
  const labels = useTaskLabels();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<'active' | 'mine' | 'done' | 'stats'>('active');
  const [label, setLabel] = useState('');
  const [edit, setEdit] = useState<Partial<Task> | null>(null);
  const toast = useToast();
  const quick = useAction((t: Task) => api(`/tasks/${t.id}`, { method: 'PATCH', body: { ...t, status: t.status === 'done' ? 'open' : 'done' } }), (_, t) =>
    toast(t.status === 'done' ? 'Wieder geöffnet' : 'Erledigt'),
  );
  // Direktlink /aufgaben?id=… (z. B. aus Benachrichtigungen)
  useEffect(() => {
    const id = params.get('id');
    if (id && data) {
      const t = data.find((x) => x.id === id);
      if (t) setEdit(t);
      setParams({}, { replace: true });
    }
  }, [params, data, setParams]);
  const canEdit = me?.user.role !== 'viewer';
  const rows = (data ?? []).filter(
    (t) =>
      (filter === 'done' ? t.status === 'done' || t.status === 'cancelled' : (t.status === 'open' || t.status === 'in_progress') && (filter !== 'mine' || t.assigneeId === me?.user.id)) &&
      (!label || t.labels?.includes(label)),
  );

  return (
    <>
      <PageHeader
        title="Aufgaben"
        subtitle="Mängelbehebung und sonstige To-dos im Team"
        actions={
          canEdit && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEdit({})}>
              Neue Aufgabe
            </Button>
          )
        }
      />
      {edit && (
        <TaskForm
          initial={edit}
          onClose={() => {
            setEdit(null);
            queryClient.invalidateQueries({ queryKey: ['tasks'] });
          }}
        />
      )}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Segmented
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'active', label: 'Offen' },
            { value: 'mine', label: 'Mir zugewiesen' },
            { value: 'done', label: 'Erledigt' },
            { value: 'stats', label: 'Übersicht' },
          ]}
        />
        {filter !== 'stats' && !!labels.data?.length && (
          <Select value={label} onChange={(e) => setLabel(e.target.value)} className="h-9 w-44" aria-label="Nach Label filtern">
            <option value="">Alle Labels</option>
            {labels.data.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
        )}
      </div>
      {filter === 'stats' ? (
        <TaskStatsView />
      ) : isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : rows.length === 0 ? (
        <Card>
          <Empty icon={<ListTodo className="size-5" />} title="Keine Aufgaben" text={filter === 'done' ? undefined : 'Aufgaben kannst du frei anlegen oder direkt aus einem Mangel erzeugen.'} />
        </Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {rows.map((t) => {
            const overdue = t.dueAt && t.dueAt < Date.now() && t.status !== 'done';
            const breached = t.status !== 'done' && t.status !== 'cancelled' && t.sla?.resolveBreached;
            return (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <button
                  disabled={!canEdit}
                  onClick={() => quick.mutate(t)}
                  aria-label={t.status === 'done' ? 'Wieder öffnen' : 'Erledigen'}
                  className={clsx('grid size-5 shrink-0 place-items-center rounded-full border-2 transition', t.status === 'done' ? 'border-ok bg-ok text-white' : 'border-line-strong hover:border-ok')}
                >
                  {t.status === 'done' && (
                    <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M2.5 6.5l2.5 2.5 4.5-5" />
                    </svg>
                  )}
                </button>
                <button className="min-w-0 flex-1 text-left" onClick={() => canEdit && setEdit(t)}>
                  <p className={clsx('truncate text-sm font-medium', t.status === 'done' && 'text-ink-3 line-through')}>{t.title}</p>
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
                    {t.status === 'in_progress' && <span className="font-medium text-info">In Arbeit</span>}
                    {t.assigneeName && <span>{t.assigneeName}</span>}
                    {t.subcontractorName && (
                      <span className="inline-flex items-center gap-1">
                        <HardHat className="size-3" />
                        {t.subcontractorName}
                      </span>
                    )}
                    {t.assetCode && (
                      <Link to={`/elemente/${t.assetId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                        {t.assetCode}
                      </Link>
                    )}
                    {t.propertyName && !t.assetCode && <span>{t.propertyName}</span>}
                    {t.externalDoneAt && <span className="font-medium text-ok">extern erledigt</span>}
                    {t.comments > 0 && (
                      <span className="inline-flex items-center gap-0.5">
                        <MessageSquare className="size-3" />
                        {t.comments}
                      </span>
                    )}
                    {t.labels?.map((l) => <LabelChip key={l} id={l} />)}
                  </p>
                </button>
                {breached && (
                  <span title="SLA-Lösungsfrist überschritten" className="hidden items-center gap-1 text-xs font-medium text-bad sm:flex">
                    <AlarmClock className="size-3.5" /> SLA
                  </span>
                )}
                {t.dueAt && (
                  <span className={clsx('hidden items-center gap-1 text-xs sm:flex', overdue ? 'font-medium text-bad' : 'text-ink-3')}>
                    <Calendar className="size-3.5" /> {fmtDate(t.dueAt)}
                  </span>
                )}
                <Badge tone={PRIO[t.priority].tone}>{PRIO[t.priority].label}</Badge>
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}

const fmtDuration = (ms: number | null) => {
  if (ms == null) return '–';
  const h = ms / 3_600_000;
  return h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} Tage`;
};

function Kpi({ label, value, sub, tone }: { label: string; value: string | number; sub?: string; tone?: 'bad' | 'ok' }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-ink-3">{label}</p>
      <p className={clsx('mt-1 text-2xl font-semibold tabular-nums', tone === 'bad' && 'text-bad', tone === 'ok' && 'text-ok')}>{value}</p>
      {sub && <p className="text-xs text-ink-3">{sub}</p>}
    </Card>
  );
}

function TaskStatsView() {
  const [days, setDays] = useState(30);
  const { data, isLoading } = useTaskStats(days);
  if (isLoading || !data) return <Spinner />;
  const maxLoad = Math.max(1, ...data.workload.map((w) => w.open));
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-2 text-sm text-ink-2">
        <BarChart3 className="size-4" /> Zeitraum
        <Select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 w-40">
          {[7, 30, 90, 365].map((d) => (
            <option key={d} value={d}>
              letzte {d} Tage
            </option>
          ))}
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Offen" value={data.backlog.open} sub={`${data.backlog.overdue} überfällig`} tone={data.backlog.overdue ? 'bad' : undefined} />
        <Kpi label="Erstellt / erledigt" value={`${data.throughput.created} / ${data.throughput.closed}`} sub="im Zeitraum" />
        <Kpi label="Ø Lösungszeit" value={fmtDuration(data.resolution.avgResolutionMs)} sub={`Ø Reaktion ${fmtDuration(data.resolution.avgResponseMs)}`} />
        <Kpi
          label="SLA-Einhaltung"
          value={data.sla.compliancePct == null ? '–' : `${data.sla.compliancePct} %`}
          sub={`${data.sla.breached} von ${data.sla.total} verletzt`}
          tone={data.sla.compliancePct != null ? (data.sla.compliancePct >= 90 ? 'ok' : 'bad') : undefined}
        />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Offene nach Priorität" />
          <ul className="space-y-3 p-5">
            {(['high', 'medium', 'low'] as const).map((p) => (
              <li key={p} className="flex items-center gap-3 text-sm">
                <span className="w-16">{PRIO[p].label}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
                  <span
                    className={clsx('block h-full rounded-full', p === 'high' ? 'bg-bad' : p === 'medium' ? 'bg-warn' : 'bg-ink-3')}
                    style={{ width: `${(data.backlog.byPriority[p] / Math.max(1, data.backlog.open)) * 100}%` }}
                  />
                </span>
                <span className="w-8 text-right tabular-nums">{data.backlog.byPriority[p]}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <CardHeader title="Auslastung" subtitle="Offene Aufgaben je Person" />
          <ul className="space-y-3 p-5">
            {data.workload.length === 0 && <li className="text-sm text-ink-3">Keine offenen Aufgaben.</li>}
            {data.workload.map((w) => (
              <li key={w.name} className="flex items-center gap-3 text-sm">
                <span className="w-36 truncate">{w.name}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-sunken">
                  <span className="block h-full rounded-full bg-ink" style={{ width: `${(w.open / maxLoad) * 100}%` }} />
                </span>
                <span className="w-16 text-right text-xs tabular-nums">
                  {w.open}
                  {w.overdue > 0 && <span className="text-bad"> ({w.overdue}!)</span>}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

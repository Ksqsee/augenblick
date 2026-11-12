import clsx from 'clsx';
import {
  AlarmClock,
  BarChart3,
  Calendar,
  ClipboardCheck,
  Copy,
  Eye,
  EyeOff,
  HardHat,
  Link2,
  ListTodo,
  MessageSquare,
  Plus,
  Send,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { groupByDue, TASK_KINDS, type TaskKind } from '../../shared/tasks';
import {
  api,
  type Asset,
  queryClient,
  type Task,
  type TaskComment,
  useAction,
  useMe,
  useMembers,
  useSubcontractors,
  useTaskComments,
  useTaskLabels,
  useTasks,
  useTaskStats,
  useTaskWatchers,
} from '../api';
import { useStartInspection } from '../components/AssetDrawer';
import { COLOR_CLASSES } from '../components/CategoryIcon';
import { ResolveDefectDialog } from '../components/DefectResolve';
import { Badge, Button, Card, CardHeader, Chip, Empty, ErrorBox, Field, Input, Modal, PageHeader, Segmented, Select, Spinner, Textarea, useToast } from '../components/ui';
import { fmtDate, fmtDateTime, fmtRelative } from '../format';

const STATUS: Record<Task['status'], string> = { open: 'Offen', in_progress: 'In Arbeit', done: 'Erledigt', cancelled: 'Abgebrochen' };
const PRIO: Record<Task['priority'], { label: string; tone: 'bad' | 'warn' | 'muted' }> = {
  high: { label: 'Hoch', tone: 'bad' },
  medium: { label: 'Mittel', tone: 'warn' },
  low: { label: 'Niedrig', tone: 'muted' },
};
const KIND_ICON: Record<TaskKind, typeof Wrench> = { inspection: ClipboardCheck, defect: Wrench, other: ListTodo };

const toDateInput = (ts: number | null) => (ts ? new Date(ts).toISOString().slice(0, 10) : '');
const fromDateInput = (s: string) => (s ? new Date(`${s}T12:00:00`).getTime() : null);

function LabelChip({ id }: { id: string }) {
  const { data } = useTaskLabels();
  const l = data?.find((x) => x.id === id);
  if (!l) return null;
  return <span className={clsx('rounded-full px-2 py-0.5 text-[11px] font-medium', COLOR_CLASSES[l.color])}>{l.name}</span>;
}

/** Aufgabe so speichern, wie sie ist, nur mit geändertem Status. */
function patchStatus(t: Task, status: Task['status'], resolveDefect = true) {
  return api(`/tasks/${t.id}`, { method: 'PATCH', body: { ...t, status, resolveDefect } });
}

/** Erledigen einer Mängelbehebung mit offenem Mangel: Rückfrage, ob der Mangel behoben ist. */
const needsDefectQuestion = (t: Pick<Task, 'kind' | 'defectId' | 'defectStatus'>) => t.kind === 'defect' && !!t.defectId && t.defectStatus !== 'resolved';

function WatchButton({ task }: { task: Partial<Task> & { id: string } }) {
  const watchers = useTaskWatchers(task.id);
  const { data: me } = useMe();
  const watching = !!watchers.data?.some((w) => w.userId === me?.user.id);
  const toggle = useAction(() => api(`/tasks/${task.id}/watch`, { method: watching ? 'DELETE' : 'POST' }));
  const names = watchers.data?.map((w) => w.name) ?? [];
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-ink-3 sm:col-span-2">
      <Button
        type="button"
        size="sm"
        variant="secondary"
        aria-pressed={watching}
        icon={watching ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        loading={toggle.isPending}
        onClick={() => toggle.mutate(undefined)}
      >
        {watching ? 'Nicht mehr beobachten' : 'Beobachten'}
      </Button>
      <span data-testid="watchers">{names.length ? `Beobachtet von ${names.join(', ')}` : 'Niemand beobachtet diese Aufgabe'}</span>
    </div>
  );
}

export function TaskForm({ initial, onClose }: { initial?: Partial<Task>; onClose: () => void }) {
  const toast = useToast();
  const members = useMembers();
  const subs = useSubcontractors();
  const labels = useTaskLabels();
  const { data: me } = useMe();
  const start = useStartInspection();
  const canEdit = me?.user.role !== 'viewer';
  const [f, setF] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    kind: (initial?.kind ?? (initial?.defectId ? 'defect' : 'other')) as TaskKind,
    assetCode: initial?.assetCode ?? '',
    status: initial?.status ?? 'open',
    priority: initial?.priority ?? 'medium',
    due: toDateInput(initial?.dueAt ?? null),
    assigneeId: initial?.assigneeId ?? '',
    subcontractorId: initial?.subcontractorId ?? '',
    labels: initial?.labels ?? [],
  });
  const [askDefect, setAskDefect] = useState(false);
  const [shareToken, setShareToken] = useState(initial?.shareToken ?? null);
  const share = useAction(() => api<{ token: string }>(`/tasks/${initial!.id}/share`, { method: 'POST' }), (r) => setShareToken(r.token));
  const unshare = useAction(() => api(`/tasks/${initial!.id}/share`, { method: 'DELETE' }), () => setShareToken(null));
  const shareUrl = shareToken ? `${window.location.origin}/extern/${shareToken}` : '';
  const completing = f.status === 'done' && initial?.status !== 'done';
  const ask = completing && needsDefectQuestion({ kind: f.kind, defectId: initial?.defectId ?? null, defectStatus: initial?.defectStatus ?? null }) && !!initial?.id;
  const save = useAction(
    async () => {
      // Element per Code: unverändert → bisherige Verknüpfung, sonst nachschlagen
      const code = f.assetCode.trim();
      let assetId: string | null = !code && initial?.assetId && !initial.assetCode ? initial.assetId : null;
      if (code) assetId = code === (initial?.assetCode ?? '') && initial?.assetId ? initial.assetId : (await api<{ id: string }>(`/assets/by-code/${encodeURIComponent(code)}`)).id;
      const body = {
        title: f.title,
        description: f.description,
        kind: f.kind,
        status: f.status,
        priority: f.priority,
        dueAt: fromDateInput(f.due),
        assigneeId: f.assigneeId || null,
        subcontractorId: f.subcontractorId || null,
        assetId,
        defectId: initial?.defectId ?? null,
        propertyId: initial?.propertyId ?? null,
        labels: f.labels,
        // Mangel wird nach Rückfrage separat (mit Notiz/Foto) behoben
        resolveDefect: !ask,
      };
      return initial?.id ? api(`/tasks/${initial.id}`, { method: 'PATCH', body }) : api('/tasks', { body });
    },
    () => {
      toast(initial?.id ? 'Aufgabe gespeichert' : 'Aufgabe angelegt');
      if (ask) setAskDefect(true);
      else onClose();
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
  if (askDefect && initial?.defectId)
    return (
      <ResolveDefectDialog
        defectId={initial.defectId}
        title="Mangel auch als behoben markieren?"
        intro={`Die Aufgabe ist erledigt. Ist damit auch der Mangel „${initial.defectTitle ?? ''}“ behoben? Notiz und Nachher-Foto sind optional.`}
        skipLabel="Nur Aufgabe erledigen"
        onSkip={onClose}
        onClose={onClose}
      />
    );
  return (
    <Modal
      wide
      title={initial?.id ? (canEdit ? 'Aufgabe bearbeiten' : 'Aufgabe') : 'Neue Aufgabe'}
      onClose={onClose}
      footer={
        <>
          {initial?.id && isAdmin && (
            <Button variant="ghost" className="mr-auto text-bad" icon={<Trash2 className="size-4" />} onClick={() => confirm('Aufgabe löschen?') && del.mutate(undefined)}>
              Löschen
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            {canEdit ? 'Abbrechen' : 'Schließen'}
          </Button>
          {canEdit && (
            <Button form="task-form" loading={save.isPending}>
              Speichern
            </Button>
          )}
        </>
      }
    >
      <form
        id="task-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        <fieldset disabled={!canEdit} className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
          {save.error && (
            <div className="sm:col-span-2">
              <ErrorBox error={save.error} />
            </div>
          )}
          {initial?.id && <WatchButton task={{ ...initial, id: initial.id }} />}
          {initial?.sla && initial.status !== 'done' && (
            <div className="flex flex-wrap gap-2 text-xs sm:col-span-2">
              <Badge tone={initial.sla.responseBreached ? 'bad' : 'muted'}>Reaktion bis {fmtDateTime(initial.sla.responseDue)}</Badge>
              <Badge tone={initial.sla.resolveBreached ? 'bad' : 'muted'}>Lösung bis {fmtDateTime(initial.sla.resolveDue)}</Badge>
            </div>
          )}
          <Field label="Titel" className="sm:col-span-2">
            {(id) => <Input id={id} required autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}
          </Field>
          <Field label="Typ">
            {(id) => (
              <Select id={id} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as TaskKind })}>
                {(Object.keys(TASK_KINDS) as TaskKind[]).map((k) => (
                  <option key={k} value={k} disabled={k === 'defect' && !initial?.defectId}>
                    {TASK_KINDS[k]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Element (Code)" hint={f.kind === 'inspection' ? 'Pflicht für Prüfaufträge' : 'optional'}>
            {(id) => (
              <Input
                id={id}
                list="task-asset-codes"
                required={f.kind === 'inspection'}
                value={f.assetCode}
                placeholder="z. B. FL-7K2M"
                onChange={(e) => setF({ ...f, assetCode: e.target.value.toUpperCase() })}
              />
            )}
          </Field>
          <AssetCodes />
          {f.kind === 'inspection' && initial?.assetId && f.assetCode === initial.assetCode && canEdit && (
            <div className="sm:col-span-2">
              <Button type="button" size="sm" icon={<ClipboardCheck className="size-4" />} loading={start.isPending} onClick={() => start.mutate(initial.assetId!)}>
                Prüfung starten
              </Button>
              <p className="mt-1 text-xs text-ink-3">Mit dem Abschluss der Prüfung wird dieser Prüfauftrag automatisch erledigt.</p>
            </div>
          )}
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
          {initial?.id && canEdit && f.subcontractorId && f.subcontractorId === initial.subcontractorId && (
            <div className="min-w-0 rounded-lg border border-line bg-sunken/50 p-3 sm:col-span-2">
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
              <p className="mt-2 text-xs text-ink-3">Über den Link sieht die Firma nur diese Aufgabe (ohne interne Notizen) und kann sie als erledigt melden – ohne Konto.</p>
            </div>
          )}
          {initial?.defectId && (
            <p className="text-xs text-ink-3 sm:col-span-2">
              Verknüpft mit dem Mangel {initial.defectTitle ? `„${initial.defectTitle}“` : ''}
              {initial.defectStatus === 'resolved' ? ' (bereits behoben).' : ' – beim Erledigen wirst du gefragt, ob er behoben ist.'}{' '}
              <Link to={`/maengel?id=${initial.defectId}`} className="font-medium text-ink-2 hover:underline">
                Mangel öffnen
              </Link>
            </p>
          )}
        </fieldset>
      </form>
      {initial?.id && <Comments taskId={initial.id} canWrite={canEdit} />}
    </Modal>
  );
}

/** Vorschlagsliste für Element-Codes (aus dem Zugriffsbereich). */
function AssetCodes() {
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
    <datalist id="task-asset-codes">
      {codes.map((c) => (
        <option key={c} value={c} />
      ))}
    </datalist>
  );
}

/** Kommentartext mit hervorgehobenen @-Erwähnungen. */
function CommentBody({ c, names }: { c: TaskComment; names: Map<string, string> }) {
  const mentioned = (c.mentions ?? []).map((m) => names.get(m)).filter((n): n is string => !!n);
  if (!mentioned.length) return <p className="text-sm break-words whitespace-pre-line">{c.body}</p>;
  const re = new RegExp(`(${mentioned.map((n) => `@${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).join('|')})`, 'g');
  return (
    <p className="text-sm break-words whitespace-pre-line">
      {c.body.split(re).map((part, i) =>
        mentioned.some((n) => part === `@${n}`) ? (
          <span key={i} className="rounded bg-brand-soft px-0.5 font-medium text-brand-strong">
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </p>
  );
}

function Comments({ taskId, canWrite }: { taskId: string; canWrite: boolean }) {
  const { data } = useTaskComments(taskId);
  const members = useMembers();
  const { data: me } = useMe();
  const [body, setBody] = useState('');
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const names = useMemo(() => new Map((members.data?.members ?? []).map((m) => [m.id, m.name])), [members.data]);
  // Erwähnung beginnt mit @ am Wortanfang bis zur Schreibmarke
  const query = /(?:^|\s)@([^\s@]{0,30})$/.exec(body.slice(0, caret))?.[1];
  const suggestions =
    query == null
      ? []
      : (members.data?.members ?? []).filter((m) => m.id !== me?.user.id && m.name.toLowerCase().includes(query.toLowerCase())).slice(0, 6);
  const add = useAction(
    () => api(`/tasks/${taskId}/comments`, { body: { body, mentions: picked.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id) } }),
    () => {
      setBody('');
      setPicked([]);
    },
  );
  const choose = (m: { id: string; name: string }) => {
    const before = body.slice(0, caret).replace(/@([^\s@]{0,30})$/, `@${m.name} `);
    const next = before + body.slice(caret);
    setBody(next);
    setPicked((p) => (p.some((x) => x.id === m.id) ? p : [...p, { id: m.id, name: m.name }]));
    setCaret(before.length);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(before.length, before.length);
    });
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!suggestions.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : suggestions.length - 1)) % suggestions.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      choose(suggestions[Math.min(active, suggestions.length - 1)]);
    } else if (e.key === 'Escape') {
      e.stopPropagation();
      setCaret(0);
    }
  };
  return (
    <div className="mt-6 border-t border-line pt-4">
      <p className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink-2">
        <MessageSquare className="size-4" /> Verlauf und interne Notizen
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
              <CommentBody c={c} names={names} />
            </div>
          </li>
        ))}
        {!data?.length && <li className="text-sm text-ink-3">Noch keine Kommentare.</li>}
      </ul>
      {canWrite && (
        <form
          className="relative flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (body.trim()) add.mutate(undefined);
          }}
        >
          <Input
            ref={input}
            placeholder="Kommentar schreiben … (@ erwähnt jemanden)"
            aria-label="Kommentar"
            value={body}
            onKeyDown={onKey}
            onChange={(e) => {
              setBody(e.target.value);
              setCaret(e.target.selectionStart ?? e.target.value.length);
              setActive(0);
            }}
            onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          />
          <Button variant="secondary" loading={add.isPending} aria-label="Senden">
            <Send className="size-4" />
          </Button>
          {suggestions.length > 0 && (
            <ul role="listbox" aria-label="Teammitglied erwähnen" className="absolute bottom-full left-0 z-10 mb-1 w-64 max-w-full overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
              {suggestions.map((m, i) => (
                <li key={m.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={i === active}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(m);
                    }}
                    className={clsx('flex w-full items-center gap-2 px-3 py-2 text-left text-sm', i === active ? 'bg-sunken' : 'hover:bg-sunken')}
                  >
                    <span className="truncate font-medium">{m.name}</span>
                    <span className="truncate text-xs text-ink-3">{m.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </form>
      )}
      {add.error && (
        <div className="mt-2">
          <ErrorBox error={add.error} />
        </div>
      )}
    </div>
  );
}

type Quick = '' | 'mine' | 'unassigned' | 'created' | 'watching';
const QUICK: { value: Exclude<Quick, ''>; label: string }[] = [
  { value: 'mine', label: 'Meine' },
  { value: 'unassigned', label: 'Ohne Zuständige' },
  { value: 'created', label: 'Von mir erstellt' },
  { value: 'watching', label: 'Beobachtet' },
];

export function TasksPage() {
  const { data, isLoading, error } = useTasks();
  const { data: me } = useMe();
  const labels = useTaskLabels();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState<'active' | 'done' | 'stats'>('active');
  const [quick, setQuick] = useState<Quick>('');
  const [kind, setKind] = useState<'' | TaskKind>('');
  const [label, setLabel] = useState('');
  const [edit, setEdit] = useState<Partial<Task> | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolveFor, setResolveFor] = useState<Task | null>(null);
  const toast = useToast();
  const quickDone = useAction(
    (v: { t: Task; resolveDefect: boolean }) => patchStatus(v.t, v.t.status === 'done' ? 'open' : 'done', v.resolveDefect),
    (_, v) => {
      toast(v.t.status === 'done' ? 'Wieder geöffnet' : 'Erledigt');
      if (v.t.status !== 'done' && !v.resolveDefect) setResolveFor(v.t);
    },
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
  const myId = me?.user.id;
  const rows = (data ?? []).filter(
    (t) =>
      (view === 'done' ? t.status === 'done' || t.status === 'cancelled' : t.status === 'open' || t.status === 'in_progress') &&
      (quick !== 'mine' || t.assigneeId === myId) &&
      (quick !== 'unassigned' || (!t.assigneeId && !t.subcontractorId)) &&
      (quick !== 'created' || t.createdBy === myId) &&
      (quick !== 'watching' || t.watching) &&
      (!kind || t.kind === kind) &&
      (!label || t.labels?.includes(label)),
  );
  const groups = view === 'done' ? [{ key: 'done', label: 'Erledigt und abgebrochen', items: [...rows].sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0)) }] : groupByDue(rows, Date.now());
  const visibleIds = rows.map((r) => r.id);
  const sel = [...selected].filter((id) => visibleIds.includes(id));
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <PageHeader
        title="Aufgaben"
        subtitle="Prüfaufträge, Mängelbehebung und sonstige To-dos im Team"
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
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Segmented
          value={view}
          onChange={(v) => {
            setView(v);
            setSelected(new Set());
          }}
          options={[
            { value: 'active', label: 'Offen', count: (data ?? []).filter((t) => t.status === 'open' || t.status === 'in_progress').length },
            { value: 'done', label: 'Erledigt' },
            { value: 'stats', label: 'Übersicht' },
          ]}
        />
        {view !== 'stats' && (
          <>
            <Select value={kind} onChange={(e) => setKind(e.target.value as '' | TaskKind)} className="h-9 w-44" aria-label="Nach Typ filtern">
              <option value="">Alle Typen</option>
              {(Object.keys(TASK_KINDS) as TaskKind[]).map((k) => (
                <option key={k} value={k}>
                  {TASK_KINDS[k]}
                </option>
              ))}
            </Select>
            {!!labels.data?.length && (
              <Select value={label} onChange={(e) => setLabel(e.target.value)} className="h-9 w-44" aria-label="Nach Label filtern">
                <option value="">Alle Labels</option>
                {labels.data.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
          </>
        )}
      </div>
      {view !== 'stats' && (
        <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Schnellfilter">
          {QUICK.map((q) => (
            <Chip key={q.value} active={quick === q.value} onClick={() => setQuick(quick === q.value ? '' : q.value)}>
              {q.label}
            </Chip>
          ))}
        </div>
      )}
      {view === 'stats' ? (
        <TaskStatsView />
      ) : isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : rows.length === 0 ? (
        <Card>
          <Empty icon={<ListTodo className="size-5" />} title="Keine Aufgaben" text={view === 'done' ? undefined : 'Aufgaben kannst du frei anlegen oder direkt aus einem Mangel erzeugen.'} />
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <section key={g.key} aria-label={g.label}>
              <div className="mb-2 flex items-center gap-2 px-1">
                {canEdit && (
                  <input
                    type="checkbox"
                    className="size-4 accent-ink"
                    aria-label={`Alle in „${g.label}“ auswählen`}
                    checked={g.items.every((t) => selected.has(t.id))}
                    onChange={(e) =>
                      setSelected((s) => {
                        const n = new Set(s);
                        for (const t of g.items) e.target.checked ? n.add(t.id) : n.delete(t.id);
                        return n;
                      })
                    }
                  />
                )}
                <h2 className={clsx('text-[13px] font-semibold', g.key === 'overdue' ? 'text-bad' : 'text-ink-2')}>{g.label}</h2>
                <span className="rounded-full bg-sunken px-1.5 text-[11px] text-ink-3 tabular-nums">{g.items.length}</span>
              </div>
              <Card className="divide-y divide-line overflow-hidden">
                {g.items.map((t) => (
                  <TaskRow
                    key={t.id}
                    t={t}
                    canEdit={canEdit}
                    selected={selected.has(t.id)}
                    onSelect={() => toggle(t.id)}
                    onOpen={() => setEdit(t)}
                    onToggleDone={() => quickDone.mutate({ t, resolveDefect: !(t.status !== 'done' && needsDefectQuestion(t)) })}
                  />
                ))}
              </Card>
            </section>
          ))}
        </div>
      )}
      {canEdit && sel.length > 0 && view !== 'stats' && <BulkBar ids={sel} tasks={rows.filter((r) => sel.includes(r.id))} onDone={() => setSelected(new Set())} />}
    </>
  );
}

function TaskRow({ t, canEdit, selected, onSelect, onOpen, onToggleDone }: { t: Task; canEdit: boolean; selected: boolean; onSelect: () => void; onOpen: () => void; onToggleDone: () => void }) {
  const overdue = t.dueAt && t.dueAt < Date.now() && t.status !== 'done';
  const breached = t.status !== 'done' && t.status !== 'cancelled' && t.sla?.resolveBreached;
  const KindIcon = KIND_ICON[t.kind ?? 'other'];
  const start = useStartInspection();
  return (
    <div className={clsx('flex items-center gap-3 px-4 py-3 sm:px-5', selected && 'bg-sunken/60')} data-task={t.id}>
      {canEdit && <input type="checkbox" className="size-4 shrink-0 accent-ink" aria-label={`„${t.title}“ auswählen`} checked={selected} onChange={onSelect} />}
      <button
        disabled={!canEdit}
        onClick={onToggleDone}
        aria-label={t.status === 'done' ? 'Wieder öffnen' : 'Erledigen'}
        className={clsx('grid size-5 shrink-0 place-items-center rounded-full border-2 transition', t.status === 'done' ? 'border-ok bg-ok text-white' : 'border-line-strong hover:border-ok')}
      >
        {t.status === 'done' && (
          <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2.5 6.5l2.5 2.5 4.5-5" />
          </svg>
        )}
      </button>
      <button className="min-w-0 flex-1 text-left" onClick={onOpen}>
        <p className={clsx('flex min-w-0 items-center gap-1.5 text-sm font-medium', t.status === 'done' && 'text-ink-3 line-through')}>
          <KindIcon className="size-3.5 shrink-0 text-ink-3" aria-label={TASK_KINDS[t.kind ?? 'other']} />
          <span className="truncate">{t.title}</span>
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-3">
          {t.status === 'in_progress' && <span className="font-medium text-info">In Arbeit</span>}
          {t.assigneeName ? <span>{t.assigneeName}</span> : !t.subcontractorName && <span className="italic">ohne Zuständige</span>}
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
          {t.watching && <Eye className="size-3" aria-label="Beobachtet" />}
          {t.dueAt && <span className={clsx('sm:hidden', overdue && 'font-medium text-bad')}>{fmtDate(t.dueAt)}</span>}
          {t.labels?.map((l) => <LabelChip key={l} id={l} />)}
        </p>
      </button>
      {t.kind === 'inspection' && t.assetId && canEdit && t.status !== 'done' && t.status !== 'cancelled' && (
        <Button size="sm" variant="secondary" className="hidden sm:inline-flex" icon={<ClipboardCheck className="size-3.5" />} loading={start.isPending} onClick={() => start.mutate(t.assetId!)}>
          Prüfen
        </Button>
      )}
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
}

/** Leiste für die Mehrfachbearbeitung der ausgewählten Aufgaben. */
function BulkBar({ ids, tasks, onDone }: { ids: string[]; tasks: Task[]; onDone: () => void }) {
  const members = useMembers();
  const toast = useToast();
  const [v, setV] = useState({ status: '', assigneeId: '', priority: '', due: '' });
  const apply = useAction(
    () => {
      const withDefect = tasks.filter((t) => needsDefectQuestion(t)).length;
      const body: Record<string, unknown> = { ids };
      if (v.status) body.status = v.status;
      if (v.assigneeId) body.assigneeId = v.assigneeId === '-' ? null : v.assigneeId;
      if (v.priority) body.priority = v.priority;
      if (v.due) body.dueAt = v.due === '-' ? null : fromDateInput(v.due);
      if (v.status === 'done' && withDefect) body.resolveDefects = confirm(`${withDefect} verknüpfte Mängel ebenfalls als behoben markieren?`);
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
    <div className="sticky bottom-20 z-20 mt-4 lg:bottom-4" role="region" aria-label="Mehrfachbearbeitung">
      <Card className="flex flex-col gap-2 p-3 shadow-pop">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{ids.length} ausgewählt</p>
          <Button size="sm" variant="ghost" icon={<X className="size-3.5" />} onClick={onDone}>
            Auswahl aufheben
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <Select aria-label="Status für Auswahl" value={v.status} onChange={(e) => setV({ ...v, status: e.target.value })} className="h-9">
            <option value="">Status …</option>
            {Object.entries(STATUS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
          <Select aria-label="Zuständig für Auswahl" value={v.assigneeId} onChange={(e) => setV({ ...v, assigneeId: e.target.value })} className="h-9">
            <option value="">Zuständig …</option>
            <option value="-">Niemand</option>
            {members.data?.members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <Select aria-label="Priorität für Auswahl" value={v.priority} onChange={(e) => setV({ ...v, priority: e.target.value })} className="h-9">
            <option value="">Priorität …</option>
            {Object.entries(PRIO).map(([k, p]) => (
              <option key={k} value={k}>
                {p.label}
              </option>
            ))}
          </Select>
          <Input aria-label="Fällig am für Auswahl" type="date" value={v.due === '-' ? '' : v.due} onChange={(e) => setV({ ...v, due: e.target.value })} className="h-9" />
          <Button size="sm" className="col-span-2 sm:col-span-1" disabled={nothing} loading={apply.isPending} onClick={() => apply.mutate(undefined)}>
            Übernehmen
          </Button>
        </div>
        {apply.error && <ErrorBox error={apply.error} />}
      </Card>
    </div>
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

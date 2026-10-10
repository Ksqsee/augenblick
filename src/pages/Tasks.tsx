import clsx from 'clsx';
import { Calendar, Copy, HardHat, Link2, ListTodo, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Task, useAction, useMe, useMembers, useSubcontractors, useTasks } from '../api';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Segmented, Select, Spinner, Textarea, useToast } from '../components/ui';
import { fmtDate } from '../format';

const STATUS: Record<Task['status'], string> = { open: 'Offen', in_progress: 'In Arbeit', done: 'Erledigt', cancelled: 'Abgebrochen' };
const PRIO: Record<Task['priority'], { label: string; tone: 'bad' | 'warn' | 'muted' }> = {
  high: { label: 'Hoch', tone: 'bad' },
  medium: { label: 'Mittel', tone: 'warn' },
  low: { label: 'Niedrig', tone: 'muted' },
};

const toDateInput = (ts: number | null) => (ts ? new Date(ts).toISOString().slice(0, 10) : '');

export function TaskForm({ initial, onClose }: { initial?: Partial<Task>; onClose: () => void }) {
  const toast = useToast();
  const members = useMembers();
  const { data: me } = useMe();
  const [f, setF] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    status: initial?.status ?? 'open',
    priority: initial?.priority ?? 'medium',
    due: toDateInput(initial?.dueAt ?? null),
    assigneeId: initial?.assigneeId ?? '',
    subcontractorId: initial?.subcontractorId ?? '',
  });
  const subs = useSubcontractors();
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
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
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
        <Field label="Fällig am">{(id) => <Input id={id} type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />}</Field>
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
        {initial?.externalNote && (
          <p className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok sm:col-span-2">Rückmeldung: {initial.externalNote}</p>
        )}
        {initial?.defectId && <p className="text-xs text-ink-3 sm:col-span-2">Verknüpft mit einem Mangel – wird beim Erledigen automatisch als behoben markiert.</p>}
      </form>
    </Modal>
  );
}

export function TasksPage() {
  const { data, isLoading, error } = useTasks();
  const { data: me } = useMe();
  const [filter, setFilter] = useState<'active' | 'mine' | 'done'>('active');
  const [edit, setEdit] = useState<Partial<Task> | null>(null);
  const toast = useToast();
  const quick = useAction((t: Task) => api(`/tasks/${t.id}`, { method: 'PATCH', body: { ...t, status: t.status === 'done' ? 'open' : 'done' } }), (_, t) =>
    toast(t.status === 'done' ? 'Wieder geöffnet' : 'Erledigt'),
  );
  const canEdit = me?.user.role !== 'viewer';
  const rows = (data ?? []).filter((t) =>
    filter === 'done' ? t.status === 'done' || t.status === 'cancelled' : (t.status === 'open' || t.status === 'in_progress') && (filter !== 'mine' || t.assigneeId === me?.user.id),
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
      {edit && <TaskForm initial={edit} onClose={() => setEdit(null)} />}
      <Segmented
        className="mb-4"
        value={filter}
        onChange={setFilter}
        options={[
          { value: 'active', label: 'Offen' },
          { value: 'mine', label: 'Mir zugewiesen' },
          { value: 'done', label: 'Erledigt' },
        ]}
      />
      {isLoading ? (
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
            return (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3 sm:px-5">
                <button
                  disabled={!canEdit}
                  onClick={() => quick.mutate(t)}
                  aria-label={t.status === 'done' ? 'Wieder öffnen' : 'Erledigen'}
                  className={clsx(
                    'grid size-5 shrink-0 place-items-center rounded-full border-2 transition',
                    t.status === 'done' ? 'border-ok bg-ok text-white' : 'border-line-strong hover:border-ok',
                  )}
                >
                  {t.status === 'done' && <svg viewBox="0 0 12 12" className="size-3" fill="none" stroke="currentColor" strokeWidth="2"><path d="M2.5 6.5l2.5 2.5 4.5-5" /></svg>}
                </button>
                <button className="min-w-0 flex-1 text-left" onClick={() => canEdit && setEdit(t)}>
                  <p className={clsx('truncate text-sm font-medium', t.status === 'done' && 'text-ink-3 line-through')}>{t.title}</p>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-ink-3">
                    {t.status === 'in_progress' && <span className="font-medium text-info">In Arbeit</span>}
                    {t.assigneeName && <span>{t.assigneeName}</span>}
                    {t.subcontractorName && (
                      <span className="inline-flex items-center gap-1">
                        <HardHat className="size-3" />
                        {t.subcontractorName}
                      </span>
                    )}
                    {t.propertyName && !t.assetCode && <span>{t.propertyName}</span>}
                    {t.externalDoneAt && <span className="font-medium text-ok">extern erledigt</span>}
                    {t.assetCode && (
                      <Link to={`/elemente/${t.assetId}`} onClick={(e) => e.stopPropagation()} className="hover:underline">
                        {t.assetCode}
                      </Link>
                    )}
                  </p>
                </button>
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

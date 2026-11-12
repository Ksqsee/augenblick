import { CheckCheck, ChevronRight, ClipboardCheck, Copy, Eye, EyeOff, HardHat, Link2, Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { RECURRENCES } from '../../../shared/automation';
import { TASK_KINDS, type TaskKind } from '../../../shared/tasks';
import { api, type Task, useAction, useMe, useMembers, useSubcontractors, useTaskWatchers } from '../../api';
import { fmtDate, fmtDateTime } from '../../format';
import { useStartInspection } from '../AssetDrawer';
import { ResolveDefectDialog } from '../DefectResolve';
import { Avatar, Button, ErrorBox, Input, Menu, type MenuItem, Notice, Textarea, useConfirm, useToast } from '../ui';
import { Activity, type ActivityEvent } from './Activity';
import { AssetCodes, LabelPicker, SeverityText } from './fields';
import { fromDateInput, isOpenTask, needsDefectQuestion, patchTask, TASK_PRIO, TASK_STATUS, toDateInput } from './model';
import { PanelSection, Prop, propSelectCls, WorkPanel } from './Panel';
import { StatusToggle } from './rows';

function Watchers({ taskId }: { taskId: string }) {
  const watchers = useTaskWatchers(taskId);
  const names = watchers.data?.map((w) => w.name) ?? [];
  return (
    <span className="flex min-w-0 items-center gap-2 text-meta text-ink-3">
      {names.length > 0 && (
        <span className="flex shrink-0 -space-x-1.5">
          {names.slice(0, 4).map((n) => (
            <Avatar key={n} name={n} size="xs" className="ring-2 ring-surface" />
          ))}
        </span>
      )}
      <span data-testid="watchers" className="min-w-0 truncate">
        {names.length ? `Beobachtet von ${names.join(', ')}` : 'Niemand beobachtet diese Aufgabe'}
      </span>
    </span>
  );
}

function WatchButton({ taskId }: { taskId: string }) {
  const watchers = useTaskWatchers(taskId);
  const { data: me } = useMe();
  const watching = !!watchers.data?.some((w) => w.userId === me?.user.id);
  const toggle = useAction(() => api(`/tasks/${taskId}/watch`, { method: watching ? 'DELETE' : 'POST' }));
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      aria-pressed={watching}
      icon={watching ? <EyeOff /> : <Eye />}
      loading={toggle.isPending}
      onClick={() => toggle.mutate(undefined)}
    >
      <span className="max-sm:sr-only">{watching ? 'Nicht mehr beobachten' : 'Beobachten'}</span>
    </Button>
  );
}

/**
 * Aufgabe im Detailpanel: links Titel, Beschreibung, Verknüpfungen und Aktivität, rechts Eigenschaften.
 * Änderungen werden sofort gespeichert (kein „Speichern“-Knopf), Lesezugriff sieht alles schreibgeschützt.
 */
export function TaskPanel({ task, onClose }: { task: Task; onClose: () => void }) {
  const toast = useToast();
  const { data: me } = useMe();
  const members = useMembers();
  const subs = useSubcontractors();
  const start = useStartInspection();
  const [confirm, confirmEl] = useConfirm();
  const canEdit = me?.user.role !== 'viewer';
  const isAdmin = !!me && ['owner', 'admin'].includes(me.user.role);
  const [over, setOver] = useState<Partial<Task>>({});
  const t: Task = { ...task, ...over };
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [code, setCode] = useState(task.assetCode ?? '');
  const [askDefect, setAskDefect] = useState(false);
  useEffect(() => setTitle(task.title), [task.title]);
  useEffect(() => setDescription(task.description), [task.description]);
  useEffect(() => setCode(task.assetCode ?? ''), [task.assetCode]);

  const save = useAction(
    (changes: Partial<Task> & { resolveDefect?: boolean }) => patchTask(t, changes),
    (_, changes) => {
      setOver({});
      if (changes.status === 'done' && changes.resolveDefect === false) setAskDefect(true);
    },
  );
  const set = (changes: Partial<Task>) => {
    if (!canEdit) return;
    setOver((o) => ({ ...o, ...changes }));
    const completing = changes.status === 'done' && task.status !== 'done';
    save.mutate({ ...changes, resolveDefect: !(completing && needsDefectQuestion(t)) }, { onError: () => setOver({}) });
  };
  const commitCode = async () => {
    const c = code.trim();
    if (c === (task.assetCode ?? '')) return;
    if (!c) return set({ assetId: null, assetCode: null });
    try {
      const a = await api<{ id: string }>(`/assets/by-code/${encodeURIComponent(c)}`);
      set({ assetId: a.id, assetCode: c });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Element nicht gefunden', 'bad');
      setCode(task.assetCode ?? '');
    }
  };
  const [shareToken, setShareToken] = useState(task.shareToken);
  useEffect(() => setShareToken(task.shareToken), [task.shareToken]);
  const share = useAction(() => api<{ token: string }>(`/tasks/${task.id}/share`, { method: 'POST' }), (r) => setShareToken(r.token));
  const unshare = useAction(() => api(`/tasks/${task.id}/share`, { method: 'DELETE' }), () => setShareToken(null));
  const shareUrl = shareToken ? `${window.location.origin}/extern/${shareToken}` : '';
  const del = useAction(
    () => api(`/tasks/${task.id}`, { method: 'DELETE' }),
    () => {
      toast('Aufgabe gelöscht');
      onClose();
    },
  );

  const done = t.status === 'done';
  const events: ActivityEvent[] = [
    { id: 'created', at: t.createdAt, icon: <Plus />, title: <>{t.createdByName ?? 'Jemand'} hat die Aufgabe angelegt</> },
    ...(t.externalDoneAt ? [{ id: 'ext', at: t.externalDoneAt, icon: <HardHat />, tone: 'ok' as const, title: <>{t.subcontractorName ?? 'Die Firma'} hat sie als erledigt gemeldet</> }] : []),
    ...(t.closedAt && !isOpenTask(t) ? [{ id: 'closed', at: t.closedAt, icon: <CheckCheck />, tone: done ? ('ok' as const) : undefined, title: <>{TASK_STATUS[t.status]}</> }] : []),
  ];
  const menu: MenuItem[] = [
    {
      label: 'Link kopieren',
      icon: <Link2 />,
      onClick: async () => {
        await navigator.clipboard?.writeText(`${window.location.origin}/aufgaben?id=${task.id}`);
        toast('Link kopiert');
      },
    },
    ...(isAdmin
      ? (['separator', { label: 'Aufgabe löschen', icon: <Trash2 />, danger: true, onClick: async () => (await confirm({ title: 'Aufgabe löschen?', text: 'Kommentare und Beobachter werden mitgelöscht.', confirmLabel: 'Löschen', danger: true })) && del.mutate(undefined) }] as MenuItem[])
      : []),
  ];

  return (
    <>
      <WorkPanel
        onClose={onClose}
        label={t.title}
        eyebrow={
          <span className="flex items-center gap-1.5">
            {TASK_KINDS[t.kind ?? 'other']}
            {save.isPending && <span className="text-ink-4">· Speichert …</span>}
          </span>
        }
        actions={
          <>
            <WatchButton taskId={task.id} />
            <Menu items={menu} />
          </>
        }
        title={
          <div className="flex items-start gap-1.5">
            <span className="-mt-1.5 -ml-2.5">
              <StatusToggle done={done} progress={t.status === 'in_progress'} disabled={!canEdit} label={done ? 'Wieder öffnen' : 'Erledigen'} onToggle={() => set({ status: done ? 'open' : 'done' })} />
            </span>
            {canEdit ? (
              <textarea
                aria-label="Titel"
                rows={1}
                value={title}
                maxLength={200}
                onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
                onBlur={() => title.trim() && title !== task.title && set({ title: title.trim() })}
                className="field-sizing-content min-w-0 flex-1 resize-none rounded-md bg-transparent px-1 -mx-1 font-semibold outline-none hover:bg-hover focus:bg-hover"
              />
            ) : (
              <span className={done ? 'text-ink-3 line-through' : undefined}>{t.title}</span>
            )}
          </div>
        }
        meta={
          <>
            <Watchers taskId={task.id} />
            {isOpenTask(t) && t.sla && (
              <span className="flex flex-wrap gap-x-3 tabular-nums">
                <span className={t.sla.responseBreached ? 'text-shu' : undefined}>Reaktion bis {fmtDateTime(t.sla.responseDue)}</span>
                <span className={t.sla.resolveBreached ? 'text-shu' : undefined}>Lösung bis {fmtDateTime(t.sla.resolveDue)}</span>
              </span>
            )}
          </>
        }
        side={<Properties t={t} canEdit={canEdit} set={set} code={code} setCode={setCode} commitCode={commitCode} members={members.data?.members ?? []} subs={subs.data ?? []} error={save.error} />}
      >
        {t.kind === 'inspection' && t.assetId && isOpenTask(t) && canEdit && (
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink">Prüfauftrag für {t.assetCode}</p>
              <p className="text-meta text-ink-3">Mit dem Abschluss der Prüfung wird dieser Auftrag automatisch erledigt.</p>
            </div>
            <Button icon={<ClipboardCheck />} loading={start.isPending} onClick={() => start.mutate({ assetId: t.assetId!, taskId: t.id })}>
              Prüfung starten
            </Button>
          </div>
        )}
        {t.kind === 'defect' && t.assetId && t.defectStatus === 'open' && isOpenTask(t) && canEdit && (
          <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1">
              <p className="text-body text-ink">Behebung vor Ort prüfen</p>
              <p className="text-meta text-ink-3">Startet die Nachprüfung zu {t.assetCode}; ist der Punkt in Ordnung, gilt der Mangel als behoben.</p>
            </div>
            <Button variant="secondary" icon={<ClipboardCheck />} loading={start.isPending} onClick={() => start.mutate({ assetId: t.assetId!, taskId: t.id })}>
              Nachprüfung starten
            </Button>
          </div>
        )}
        {t.externalDoneAt && (
          <Notice tone="ok" icon={<HardHat />} title="Von der Firma als erledigt gemeldet" className="mb-6">
            {t.externalNote || `${fmtDate(t.externalDoneAt)} – ohne Notiz.`}
          </Notice>
        )}
        <PanelSection title="Beschreibung">
          {canEdit ? (
            <Textarea
              aria-label="Beschreibung"
              value={description}
              placeholder="Was ist zu tun? Ort, Zugang, Ansprechpartner …"
              onChange={(e) => setDescription(e.target.value)}
              onBlur={() => description !== task.description && set({ description })}
              className="min-h-28"
            />
          ) : (
            <p className="text-body break-words whitespace-pre-line text-ink-2">{t.description || <span className="text-ink-4">Keine Beschreibung.</span>}</p>
          )}
        </PanelSection>
        {t.defectId && (
          <PanelSection title="Mangel">
            <Link to={`/maengel?id=${t.defectId}`} className="group -mx-2 flex items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-hover">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-body text-ink">{t.defectTitle ?? 'Mangel'}</span>
                <span className="block text-meta text-ink-3">
                  {t.defectStatus === 'resolved' ? 'Bereits behoben' : 'Offen – beim Erledigen fragen wir, ob er behoben ist'}
                </span>
              </span>
              {t.defectSeverity && <SeverityText severity={t.defectSeverity} />}
              <ChevronRight className="size-4 shrink-0 text-ink-4 group-hover:text-ink-3" aria-label="Mangel öffnen" />
            </Link>
          </PanelSection>
        )}
        {canEdit && t.subcontractorId && (
          <PanelSection title="Link für den Subunternehmer">
            {shareToken ? (
              <div className="flex gap-2">
                <Input readOnly value={shareUrl} aria-label="Link für die Firma" onFocus={(e) => e.target.select()} />
                <Button
                  type="button"
                  variant="secondary"
                  aria-label="Kopieren"
                  icon={<Copy />}
                  onClick={async () => {
                    await navigator.clipboard.writeText(shareUrl);
                    toast('Link kopiert');
                  }}
                />
                <Button type="button" variant="ghost" onClick={() => unshare.mutate(undefined)}>
                  Sperren
                </Button>
              </div>
            ) : (
              <Button type="button" size="sm" variant="secondary" icon={<Link2 />} loading={share.isPending} onClick={() => share.mutate(undefined)}>
                Link erzeugen
              </Button>
            )}
            <p className="mt-2 text-caption text-ink-3">Die Firma sieht nur diese Aufgabe – ohne interne Kommentare – und kann sie ohne Konto als erledigt melden.</p>
          </PanelSection>
        )}
        <PanelSection title="Aktivität">
          <Activity taskId={task.id} canWrite={canEdit} events={events} />
        </PanelSection>
      </WorkPanel>
      {askDefect && t.defectId && (
        <ResolveDefectDialog
          defectId={t.defectId}
          title="Mangel auch als behoben markieren?"
          intro={`Die Aufgabe ist erledigt. Ist damit auch der Mangel „${t.defectTitle ?? ''}“ behoben?`}
          skipLabel="Nur Aufgabe erledigen"
          onSkip={() => setAskDefect(false)}
          onClose={() => setAskDefect(false)}
        />
      )}
      {confirmEl}
    </>
  );
}

function Properties({
  t,
  canEdit,
  set,
  code,
  setCode,
  commitCode,
  members,
  subs,
  error,
}: {
  t: Task;
  canEdit: boolean;
  set: (c: Partial<Task>) => void;
  code: string;
  setCode: (v: string) => void;
  commitCode: () => void;
  members: { id: string; name: string }[];
  subs: { id: string; company: string; trade?: string | null }[];
  error: unknown;
}) {
  const ids = { status: 'tp-status', prio: 'tp-prio', due: 'tp-due', who: 'tp-who', sub: 'tp-sub', kind: 'tp-kind', code: 'tp-code', rec: 'tp-rec' };
  return (
    <div className="flex flex-col">
      {!!error && <ErrorBox error={error} className="mb-3" />}
      <div className="grid grid-cols-2 gap-x-4 md:grid-cols-1">
        <Prop label="Status" htmlFor={ids.status}>
          <select id={ids.status} disabled={!canEdit} className={propSelectCls} value={t.status} onChange={(e) => set({ status: e.target.value as Task['status'] })}>
            {Object.entries(TASK_STATUS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Prop>
        <Prop label="Priorität" htmlFor={ids.prio}>
          <select id={ids.prio} disabled={!canEdit} className={propSelectCls} value={t.priority} onChange={(e) => set({ priority: e.target.value as Task['priority'] })}>
            {Object.entries(TASK_PRIO).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </select>
        </Prop>
        <Prop label="Fällig am" htmlFor={ids.due}>
          <input
            id={ids.due}
            type="date"
            disabled={!canEdit}
            className={`${propSelectCls} bg-none pr-2`}
            value={toDateInput(t.dueAt)}
            onChange={(e) => (e.target.value === '' || e.target.validity.valid) && set({ dueAt: fromDateInput(e.target.value) })}
          />
        </Prop>
        <Prop label="Zuständig" htmlFor={ids.who}>
          <select id={ids.who} disabled={!canEdit} className={propSelectCls} value={t.assigneeId ?? ''} onChange={(e) => set({ assigneeId: e.target.value || null, assigneeName: members.find((m) => m.id === e.target.value)?.name ?? null })}>
            <option value="">Niemand</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </Prop>
        <Prop label="Subunternehmer" htmlFor={ids.sub}>
          <select id={ids.sub} disabled={!canEdit} className={propSelectCls} value={t.subcontractorId ?? ''} onChange={(e) => set({ subcontractorId: e.target.value || null })}>
            <option value="">Keiner</option>
            {subs.map((s) => (
              <option key={s.id} value={s.id}>
                {s.company}
                {s.trade ? ` · ${s.trade}` : ''}
              </option>
            ))}
          </select>
        </Prop>
        <Prop label="Typ" htmlFor={ids.kind}>
          <select id={ids.kind} disabled={!canEdit} className={propSelectCls} value={t.kind} onChange={(e) => set({ kind: e.target.value as TaskKind })}>
            {(Object.keys(TASK_KINDS) as TaskKind[]).map((k) => (
              <option key={k} value={k} disabled={k === 'defect' && !t.defectId}>
                {TASK_KINDS[k]}
              </option>
            ))}
          </select>
        </Prop>
        <Prop label="Element (Code)" htmlFor={ids.code}>
          {canEdit ? (
            <>
              <input
                id={ids.code}
                list="task-asset-codes"
                value={code}
                placeholder="Kein Element"
                className={`${propSelectCls} bg-none pr-2 uppercase placeholder:normal-case placeholder:text-ink-4 [&::-webkit-calendar-picker-indicator]:hidden`}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                onBlur={commitCode}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
              <AssetCodes />
            </>
          ) : t.assetId ? (
            <Link to={`/elemente/${t.assetId}`} className="font-medium hover:underline">
              {t.assetCode}
            </Link>
          ) : null}
        </Prop>
        <Prop label="Wiederholen" htmlFor={ids.rec}>
          <select id={ids.rec} disabled={!canEdit} className={propSelectCls} value={t.recurrence ?? ''} onChange={(e) => set({ recurrence: (e.target.value || null) as Task['recurrence'] })}>
            <option value="">Nie</option>
            {Object.entries(RECURRENCES).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </Prop>
        {t.buildingName && <Prop label="Gebäude">{t.buildingName}</Prop>}
        <Prop label="Objekt">{t.propertyName}</Prop>
      </div>
      {t.assetId && canEdit && (
        <Link to={`/elemente/${t.assetId}`} className="mt-1 text-meta text-ink-2 hover:text-ink">
          Element öffnen ›
        </Link>
      )}
      <div className="mt-4 border-t border-line pt-4">
        <p className="mb-2 text-caption font-medium text-ink-3 md:text-meta md:font-normal">Labels</p>
        {t.labels?.length || canEdit ? <LabelPicker value={t.labels ?? []} disabled={!canEdit} onChange={(labels) => set({ labels })} /> : <span className="text-body text-ink-4">–</span>}
      </div>
      <p className="mt-4 border-t border-line pt-4 text-caption text-ink-3">
        Angelegt {fmtDate(t.createdAt)}
        {t.createdByName ? ` von ${t.createdByName}` : ''}
      </p>
    </div>
  );
}

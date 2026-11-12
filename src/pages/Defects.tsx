import clsx from 'clsx';
import { AlertTriangle, Check, ClipboardCheck, Eye, EyeOff, FileDown, Footprints, History, ListPlus, ListTodo, RotateCcw, Scale, Siren } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SEVERITIES } from '../../shared/catalog';
import { api, type Defect, type DefectDetail, fileUrl, useAction, useActionRequired, useDefect, useDefects, useMe } from '../api';
import { useStartInspection } from '../components/AssetDrawer';
import { CategoryIcon } from '../components/CategoryIcon';
import { ResolveDefectDialog } from '../components/DefectResolve';
import { Badge, Button, Card, Drawer, Empty, ErrorBox, Field, Input, KeyValue, Modal, PageHeader, Segmented, Spinner, useToast } from '../components/ui';
import { fmtDate, fmtDateTime, fmtRelative } from '../format';
import { TaskForm } from './Tasks';

const sevTone = (s: Defect['severity']) => (s === 'critical' || s === 'high' ? 'bad' : s === 'medium' ? 'warn' : 'muted');
const TASK_STATUS: Record<string, string> = { open: 'Offen', in_progress: 'In Arbeit', done: 'Erledigt', cancelled: 'Abgebrochen' };

type Tab = 'action' | 'open' | 'resolved' | 'hidden';

/** Vorlage für eine Mängelbehebung aus einem Mangel. */
const taskFromDefect = (d: Defect) => ({
  title: `Mangel beheben: ${d.title}`,
  description: [d.code && `${d.code} · ${d.location ?? ''}`, d.legalBasis && `Grundlage: ${d.legalBasis}`, d.note, d.measure && `Maßnahme: ${d.measure}`].filter(Boolean).join('\n'),
  kind: 'defect' as const,
  assetId: d.assetId ?? null,
  assetCode: d.code ?? null,
  defectId: d.id,
  defectTitle: d.title,
  propertyId: d.propertyId ?? null,
  priority: d.severity === 'critical' || d.severity === 'high' ? ('high' as const) : ('medium' as const),
});

export function DefectsPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) || 'open');
  const [source, setSource] = useState<'' | 'asset' | 'walkthrough'>('');
  const { data: me } = useMe();
  const [taskFor, setTaskFor] = useState<Defect | null>(null);
  const [resolveId, setResolveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(params.get('id'));
  const canEdit = me?.user.role !== 'viewer';
  // Direktlink /maengel?id=…
  useEffect(() => {
    const id = params.get('id');
    if (id) {
      setDetail(id);
      setParams({}, { replace: true });
    }
  }, [params, setParams]);

  return (
    <>
      <PageHeader title="Mängel" subtitle="Alle Mängel aus Prüfungen und Begehungen, objektübergreifend" />
      {/* Reihenfolge: Dialoge nach dem Detail, damit sie darüber liegen */}
      {detail && <DefectDrawer id={detail} onClose={() => setDetail(null)} onTask={setTaskFor} onResolve={setResolveId} />}
      {taskFor && <TaskForm initial={taskFromDefect(taskFor)} onClose={() => setTaskFor(null)} />}
      {resolveId && <ResolveDefectDialog defectId={resolveId} onClose={() => setResolveId(null)} />}
      <div className="mb-4 flex flex-wrap gap-2">
        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'action', label: 'Handlungsbedarf' },
            { value: 'open', label: 'Offen' },
            { value: 'resolved', label: 'Behoben' },
            { value: 'hidden', label: 'Ausgeblendet' },
          ]}
        />
        {tab !== 'action' && (
          <Segmented
            value={source}
            onChange={setSource}
            options={[
              { value: '', label: 'Alle' },
              { value: 'asset', label: 'Elemente' },
              { value: 'walkthrough', label: 'Begehungen' },
            ]}
          />
        )}
      </div>
      {tab === 'action' ? (
        <ActionRequired onDefect={setDetail} />
      ) : (
        <DefectList tab={tab} source={source} canEdit={canEdit} onOpen={setDetail} onTask={setTaskFor} onResolve={setResolveId} />
      )}
    </>
  );
}

function DefectList({
  tab,
  source,
  canEdit,
  onOpen,
  onTask,
  onResolve,
}: {
  tab: Exclude<Tab, 'action'>;
  source: '' | 'asset' | 'walkthrough';
  canEdit: boolean;
  onOpen: (id: string) => void;
  onTask: (d: Defect) => void;
  onResolve: (id: string) => void;
}) {
  const { data, isLoading, error } = useDefects(tab === 'hidden' ? 'all' : tab, source, tab === 'hidden');
  const toast = useToast();
  const reopen = useAction((id: string) => api(`/defects/${id}`, { method: 'PATCH', body: { status: 'open' } }), () => toast('Wieder geöffnet'));
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data?.length)
    return (
      <Card>
        <Empty icon={<AlertTriangle className="size-5" />} title={tab === 'open' ? 'Keine offenen Mängel' : tab === 'hidden' ? 'Nichts ausgeblendet' : 'Noch nichts behoben'} />
      </Card>
    );
  return (
    <div className="grid gap-3">
      {data.map((d) => (
        <Card key={d.id} className={clsx('flex flex-col gap-3 p-4 sm:flex-row sm:items-center', d.severity === 'critical' && d.status === 'open' && !d.hiddenAt && 'border-bad/40')}>
          <div className="flex min-w-0 flex-1 gap-3">
            {d.category ? (
              <CategoryIcon category={d.category} size="sm" />
            ) : (
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong">
                <Footprints className="size-4" />
              </span>
            )}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <button className="text-left text-sm font-semibold hover:underline" onClick={() => onOpen(d.id)}>
                  {d.title}
                </button>
                <Badge tone={sevTone(d.severity)}>{SEVERITIES[d.severity]}</Badge>
                {d.taskId && <Badge tone="info">Aufgabe</Badge>}
                {d.hiddenAt && <Badge tone="muted">Ausgeblendet</Badge>}
              </div>
              <p className="mt-0.5 text-xs text-ink-3">
                {d.assetId ? (
                  <Link to={`/elemente/${d.assetId}`} className="font-medium text-ink-2 hover:underline">
                    {d.code}
                  </Link>
                ) : (
                  <Link to={`/druck/begehung/${d.walkthroughId}`} className="font-medium text-ink-2 hover:underline">
                    Begehung
                  </Link>
                )}{' '}
                · {[d.location, d.buildingName, d.propertyName].filter(Boolean).join(' · ')} · erfasst {fmtDate(d.createdAt)}
                {d.resolvedAt && ` · behoben ${fmtDate(d.resolvedAt)}${d.resolvedByName ? ` von ${d.resolvedByName}` : ''}`}
              </p>
              {d.legalBasis && (
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-ink-3">
                  <Scale className="size-3" /> {d.legalBasis}
                </p>
              )}
              {d.note && <p className="mt-1.5 text-sm break-words text-ink-2">{d.note}</p>}
              {d.measure && (
                <p className="mt-1 text-sm break-words text-ink-2">
                  <span className="font-medium">Maßnahme:</span> {d.measure}
                </p>
              )}
              {d.resolutionNote && (
                <p className="mt-1 text-sm break-words text-ok">
                  <span className="font-medium">Behebung:</span> {d.resolutionNote}
                </p>
              )}
              {d.hiddenReason && <p className="mt-1 text-xs text-ink-3">Ausgeblendet: {d.hiddenReason}</p>}
            </div>
          </div>
          {(d.photoKey || d.resolutionPhotoKey) && (
            <div className="flex shrink-0 gap-2">
              {d.photoKey && <img src={fileUrl(d.photoKey)} alt="Foto vorher" className="h-16 w-20 rounded-lg border border-line object-cover" />}
              {d.resolutionPhotoKey && <img src={fileUrl(d.resolutionPhotoKey)} alt="Foto nachher" className="h-16 w-20 rounded-lg border border-ok/40 object-cover" />}
            </div>
          )}
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button size="sm" variant="ghost" onClick={() => onOpen(d.id)}>
              Details
            </Button>
            {canEdit &&
              !d.hiddenAt &&
              (d.status === 'open' ? (
                <>
                  {!d.taskId && (
                    <Button size="sm" variant="secondary" icon={<ListPlus className="size-3.5" />} onClick={() => onTask(d)}>
                      Aufgabe
                    </Button>
                  )}
                  <Button size="sm" icon={<Check className="size-3.5" />} onClick={() => onResolve(d.id)}>
                    Behoben
                  </Button>
                </>
              ) : (
                <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => reopen.mutate(d.id)}>
                  Wieder öffnen
                </Button>
              ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function Photo({ k, label, tone }: { k: string; label: string; tone?: 'ok' }) {
  return (
    <figure className="min-w-0">
      <a href={fileUrl(k)} target="_blank" rel="noreferrer">
        <img src={fileUrl(k)} alt={label} className={clsx('aspect-[4/3] w-full rounded-lg border object-cover', tone === 'ok' ? 'border-ok/40' : 'border-line')} />
      </a>
      <figcaption className="mt-1 text-xs text-ink-3">{label}</figcaption>
    </figure>
  );
}

/** Mangel-Detail mit allen Angaben, Fotos vorher/nachher, Aufgaben und Verlauf. */
function DefectDrawer({ id, onClose, onTask, onResolve }: { id: string; onClose: () => void; onTask: (d: Defect) => void; onResolve: (id: string) => void }) {
  const { data: d, isLoading, error } = useDefect(id);
  const { data: me } = useMe();
  const toast = useToast();
  const [hiding, setHiding] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const canEdit = me?.user.role !== 'viewer';
  const isAdmin = !!me && ['owner', 'admin'].includes(me.user.role);
  const reopen = useAction(() => api(`/defects/${id}`, { method: 'PATCH', body: { status: 'open' } }), () => toast('Wieder geöffnet'));
  const unhide = useAction(() => api(`/defects/${id}/unhide`, { method: 'POST' }), () => toast('Wieder eingeblendet'));
  const pdf = async (x: DefectDetail) => {
    if (!me) return;
    setPdfBusy(true);
    try {
      const r = await import('../pdf/reports');
      r.download(await r.defectsPdf([x], await r.loadBrand(me)), `Mangel_${(x.code ?? 'Begehung').replace(/[^\w-]/g, '')}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'PDF fehlgeschlagen', 'bad');
    } finally {
      setPdfBusy(false);
    }
  };
  return (
    <>
      <Drawer
        // contain: lange Texte dürfen das Detail auf schmalen Bildschirmen nicht verbreitern
        title={<span className="block truncate [contain:inline-size]">{d?.title ?? 'Mangel'}</span>}
        subtitle={d ? <span className="block break-words [contain:inline-size]">{[d.code ?? 'Begehung', d.location, d.buildingName, d.propertyName].filter(Boolean).join(' · ')}</span> : undefined}
        onClose={onClose}
        footer={
          d && (
            <div className="flex w-full flex-wrap gap-2 [contain:inline-size]">
              {canEdit && !d.hiddenAt && d.status === 'open' && (
                <Button size="sm" icon={<Check className="size-3.5" />} onClick={() => onResolve(d.id)}>
                  Behoben
                </Button>
              )}
              {canEdit && !d.hiddenAt && d.status === 'open' && !d.tasks.some((t) => t.status === 'open' || t.status === 'in_progress') && (
                <Button size="sm" variant="secondary" icon={<ListPlus className="size-3.5" />} onClick={() => onTask(d)}>
                  Aufgabe
                </Button>
              )}
              {canEdit && d.status === 'resolved' && !d.hiddenAt && (
                <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} loading={reopen.isPending} onClick={() => reopen.mutate(undefined)}>
                  Wieder öffnen
                </Button>
              )}
              {isAdmin &&
                (d.hiddenAt ? (
                  <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} loading={unhide.isPending} onClick={() => unhide.mutate(undefined)}>
                    Einblenden
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" icon={<EyeOff className="size-3.5" />} onClick={() => setHiding(true)}>
                    Ausblenden
                  </Button>
                ))}
              <Button size="sm" variant="ghost" className="ml-auto" icon={<FileDown className="size-3.5" />} loading={pdfBusy} onClick={() => pdf(d)}>
                PDF
              </Button>
            </div>
          )
        }
      >
        {isLoading ? (
          <Spinner />
        ) : error ? (
          <ErrorBox error={error} />
        ) : (
          d && (
            <div className="flex flex-col gap-5 [contain:inline-size]">
              <div className="flex flex-wrap gap-2">
                <Badge tone={sevTone(d.severity)}>{SEVERITIES[d.severity]}</Badge>
                <Badge tone={d.status === 'resolved' ? 'ok' : 'warn'}>{d.status === 'resolved' ? 'Behoben' : 'Offen'}</Badge>
                {d.hiddenAt && <Badge tone="muted">Ausgeblendet</Badge>}
              </div>
              {d.hiddenAt && (
                <p className="rounded-lg bg-sunken px-3 py-2 text-sm text-ink-2">
                  Ausgeblendet {fmtDate(d.hiddenAt)}
                  {d.hiddenByName ? ` von ${d.hiddenByName}` : ''}: {d.hiddenReason}
                </p>
              )}
              {(d.photoKey || d.resolutionPhotoKey) && (
                <div className="grid grid-cols-2 gap-3">
                  {d.photoKey ? <Photo k={d.photoKey} label="Vorher" /> : <div />}
                  {d.resolutionPhotoKey && <Photo k={d.resolutionPhotoKey} label="Nachher" tone="ok" />}
                </div>
              )}
              <Card className="px-4">
                <KeyValue
                  items={[
                    ['Ort', d.assetId ? <Link to={`/elemente/${d.assetId}`} className="hover:underline">{d.code}</Link> : d.walkthroughId ? <Link to={`/druck/begehung/${d.walkthroughId}`} className="hover:underline">Begehung</Link> : '–'],
                    ['Erfasst', fmtDateTime(d.createdAt)],
                    ...(d.inspectionId ? ([['Prüfprotokoll', <Link key="p" to={`/druck/protokoll/${d.inspectionId}`} className="hover:underline">öffnen</Link>]] as [string, React.ReactNode][]) : []),
                    ...(d.legalBasis ? ([['Grundlage', d.legalBasis]] as [string, string][]) : []),
                    ...(d.resolvedAt ? ([['Behoben', `${fmtDateTime(d.resolvedAt)}${d.resolvedByName ? ` · ${d.resolvedByName}` : ''}`]] as [string, string][]) : []),
                  ]}
                />
              </Card>
              {d.note && (
                <section>
                  <h3 className="mb-1 text-[13px] font-semibold text-ink-2">Beschreibung</h3>
                  <p className="text-sm break-words whitespace-pre-line">{d.note}</p>
                </section>
              )}
              {d.measure && (
                <section>
                  <h3 className="mb-1 text-[13px] font-semibold text-ink-2">Maßnahme</h3>
                  <p className="text-sm break-words">{d.measure}</p>
                </section>
              )}
              {d.status === 'resolved' && (
                <section>
                  <h3 className="mb-1 text-[13px] font-semibold text-ink-2">Behebung</h3>
                  <p className="text-sm break-words text-ink-2">{d.resolutionNote || 'Keine Notiz.'}</p>
                </section>
              )}
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
                  <ListTodo className="size-4" /> Aufgaben
                </h3>
                {d.tasks.length ? (
                  <ul className="flex flex-col gap-2">
                    {d.tasks.map((t) => (
                      <li key={t.id}>
                        <Link to={`/aufgaben?id=${t.id}`} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:border-line-strong">
                          <span className="min-w-0 truncate">{t.title}</span>
                          <span className="shrink-0 text-xs text-ink-3">
                            {TASK_STATUS[t.status]}
                            {t.assigneeName ? ` · ${t.assigneeName}` : ''}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-ink-3">Keine Aufgabe verknüpft.</p>
                )}
              </section>
              <section>
                <h3 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink-2">
                  <History className="size-4" /> Verlauf
                </h3>
                <ol className="flex flex-col gap-2 border-l border-line pl-3">
                  {d.history.map((h, i) => (
                    <li key={i} className="text-sm">
                      <p className="break-words">{h.summary}</p>
                      <p className="text-xs text-ink-3">
                        {h.userName ?? '–'} · {fmtRelative(h.createdAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
          )
        )}
      </Drawer>
      {hiding && <HideDialog id={id} onClose={() => setHiding(false)} />}
    </>
  );
}

function HideDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState('');
  const hide = useAction(
    () => api(`/defects/${id}/hide`, { body: { reason } }),
    () => {
      toast('Mangel ausgeblendet');
      onClose();
    },
  );
  return (
    <Modal
      title="Mangel ausblenden"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button form="hide-form" loading={hide.isPending} disabled={!reason.trim()}>
            Ausblenden
          </Button>
        </>
      }
    >
      <form
        id="hide-form"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          hide.mutate(undefined);
        }}
      >
        <p className="text-sm text-ink-2">Ausgeblendete Mängel zählen nicht mehr mit und erscheinen nur noch unter „Ausgeblendet“.</p>
        {hide.error && <ErrorBox error={hide.error} />}
        <div className="flex flex-wrap gap-1.5">
          {['Doppelt erfasst', 'Nicht relevant', 'Fehlerfassung'].map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)} className="rounded-full bg-sunken px-2.5 py-1 text-xs font-medium text-ink-2 hover:text-ink">
              {r}
            </button>
          ))}
        </div>
        <Field label="Grund">
          {(fid) => <Input id={fid} required autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </form>
    </Modal>
  );
}

const KIND_META = {
  defect: { icon: Siren, label: 'Mangel' },
  task: { icon: ListTodo, label: 'Aufgabe' },
  asset: { icon: ClipboardCheck, label: 'Prüfung' },
} as const;

/** Handlungsbedarf: schwere Mängel ohne Aufgabe, überfällige Aufgaben und Elemente – nach Dringlichkeit. */
function ActionRequired({ onDefect }: { onDefect: (id: string) => void }) {
  const { data, isLoading, error } = useActionRequired();
  const navigate = useNavigate();
  const start = useStartInspection();
  const { data: me } = useMe();
  const canEdit = me?.user.role !== 'viewer';
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  if (!data?.length)
    return (
      <Card>
        <Empty icon={<Check className="size-5" />} title="Alles im Griff" text="Keine schweren Mängel ohne Aufgabe, keine überfälligen Aufgaben oder Prüfungen." />
      </Card>
    );
  const counts = { defect: 0, task: 0, asset: 0 };
  for (const x of data) counts[x.kind]++;
  return (
    <>
      <p className="mb-3 text-sm text-ink-2">
        {counts.defect} schwere {counts.defect === 1 ? 'Mangel' : 'Mängel'} ohne Aufgabe · {counts.task} überfällige {counts.task === 1 ? 'Aufgabe' : 'Aufgaben'} · {counts.asset}{' '}
        überfällige {counts.asset === 1 ? 'Prüfung' : 'Prüfungen'}
      </p>
      <Card className="divide-y divide-line overflow-hidden">
        {data.map((x) => {
          const M = KIND_META[x.kind];
          const tone = x.kind === 'defect' ? (x.level === 'critical' ? 'bad' : 'warn') : x.kind === 'task' && x.level === 'high' ? 'bad' : 'warn';
          const open = () => (x.kind === 'defect' ? onDefect(x.id) : x.kind === 'task' ? navigate(`/aufgaben?id=${x.id}`) : navigate(`/elemente/${x.id}`));
          return (
            <div key={`${x.kind}-${x.id}`} className="flex items-center gap-3 px-4 py-3 sm:px-5" data-action={x.kind}>
              <span className={clsx('grid size-8 shrink-0 place-items-center rounded-lg', tone === 'bad' ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn')}>
                <M.icon className="size-4" />
              </span>
              <button className="min-w-0 flex-1 text-left" onClick={open}>
                <p className="truncate text-sm font-medium">{x.title}</p>
                <p className="truncate text-xs text-ink-3">
                  <span className="font-medium text-ink-2">{x.kind === 'defect' ? `${SEVERITIES[x.level as Defect['severity']] ?? ''} ${x.reason}` : x.reason}</span>
                  {x.kind !== 'defect' && ` seit ${fmtDate(x.at)}`} · {x.subtitle}
                </p>
              </button>
              {x.kind === 'asset' && canEdit && (
                <Button size="sm" variant="secondary" className="hidden sm:inline-flex" loading={start.isPending} onClick={() => start.mutate(x.id)}>
                  Prüfen
                </Button>
              )}
              <Badge tone={tone}>{M.label}</Badge>
            </div>
          );
        })}
      </Card>
    </>
  );
}

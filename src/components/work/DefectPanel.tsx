import { Check, Eye, EyeOff, FileDown, ListPlus, Pencil, Plus, RotateCcw } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, type Defect, type DefectDetail, useAction, useDefect, useMe } from '../../api';
import { categoryLabel, fmtDate, fmtDateTime, fmtRelative } from '../../format';
import { Button, Chip, ErrorBox, Field, Input, Modal, Notice, Skeleton, StatusDot, StatusText, Timeline, type TimelineItem, useToast } from '../ui';
import { SeverityText } from './fields';
import { TASK_STATUS } from './model';
import { PanelSection, Prop, WorkPanel } from './Panel';
import { PhotoPair } from './Photos';

const HISTORY_ICON: Record<string, { icon: ReactNode; tone?: TimelineItem['tone'] }> = {
  create: { icon: <Plus /> },
  resolve: { icon: <Check />, tone: 'ok' },
  reopen: { icon: <RotateCcw />, tone: 'warn' },
  hide: { icon: <EyeOff /> },
  unhide: { icon: <Eye /> },
};

/** Mangel im Detailpanel: Fotos vorher/nachher, Beschreibung, Maßnahme, Behebung, Aufgaben und Verlauf. */
export function DefectPanel({ id, onClose, onTask, onResolve }: { id: string; onClose: () => void; onTask: (d: Defect) => void; onResolve: (id: string) => void }) {
  const { data: d, isLoading, error, refetch } = useDefect(id);
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
      const r = await import('../../pdf/reports');
      r.download(await r.defectsPdf([x], await r.loadBrand(me)), `Mangel_${(x.code ?? 'Begehung').replace(/[^\w-]/g, '')}_${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'PDF fehlgeschlagen', 'bad');
    } finally {
      setPdfBusy(false);
    }
  };
  const resolved = d?.status === 'resolved';
  const openTask = d?.tasks.some((t) => t.status === 'open' || t.status === 'in_progress');
  return (
    <>
      <WorkPanel
        onClose={onClose}
        eyebrow={d ? (d.category ? `${categoryLabel(d.category)}${d.code ? ` · ${d.code}` : ''}` : 'Feststellung aus einer Begehung') : 'Mangel'}
        title={d?.title ?? (isLoading ? <Skeleton className="h-6 w-2/3" /> : 'Mangel')}
        meta={
          d && (
            <>
              <SeverityText severity={d.severity} />
              <StatusText tone={resolved ? 'ok' : 'muted'}>{resolved ? 'Behoben' : 'Offen'}</StatusText>
              {d.hiddenAt && <span className="text-ink-2">Ausgeblendet</span>}
            </>
          )
        }
        side={
          d && (
            <div className="grid grid-cols-2 gap-x-4 md:grid-cols-1">
              <Prop label="Ort">
                {d.assetId ? (
                  <Link to={`/elemente/${d.assetId}`} className="font-medium underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                    {d.code}
                  </Link>
                ) : d.walkthroughId ? (
                  <Link to={`/druck/begehung/${d.walkthroughId}`} className="underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                    Begehung
                  </Link>
                ) : null}
                {d.location && <span className="block text-meta text-ink-3">{d.location}</span>}
              </Prop>
              <Prop label="Objekt">
                {d.propertyName}
                {d.buildingName && <span className="block text-meta text-ink-3">{d.buildingName}</span>}
              </Prop>
              <Prop label="Erfasst">{fmtDateTime(d.createdAt)}</Prop>
              {d.resolvedAt && (
                <Prop label="Behoben am">
                  {fmtDateTime(d.resolvedAt)}
                  {d.resolvedByName && <span className="block text-meta text-ink-3">{d.resolvedByName}</span>}
                </Prop>
              )}
              {d.inspectionId && (
                <Prop label="Prüfprotokoll">
                  <Link to={`/druck/protokoll/${d.inspectionId}`} className="underline decoration-line-strong underline-offset-4 hover:decoration-ink">
                    Öffnen ›
                  </Link>
                </Prop>
              )}
              {d.legalBasis && (
                <div className="col-span-2 md:col-span-1">
                  <Prop label="Grundlage">{d.legalBasis}</Prop>
                </div>
              )}
            </div>
          )
        }
        footer={
          d && (
            <>
              {canEdit && !d.hiddenAt && !resolved && (
                <Button icon={<Check />} className="max-sm:flex-1" onClick={() => onResolve(d.id)}>
                  Behoben
                </Button>
              )}
              {canEdit && !d.hiddenAt && !resolved && !openTask && (
                <Button variant="secondary" icon={<ListPlus />} className="max-sm:flex-1" onClick={() => onTask(d)}>
                  Aufgabe anlegen
                </Button>
              )}
              {canEdit && resolved && !d.hiddenAt && (
                <Button variant="secondary" icon={<RotateCcw />} loading={reopen.isPending} onClick={() => reopen.mutate(undefined)}>
                  Wieder öffnen
                </Button>
              )}
              <span className="ml-auto flex items-center gap-1">
                {isAdmin &&
                  (d.hiddenAt ? (
                    <Button size="sm" variant="ghost" icon={<Eye />} loading={unhide.isPending} onClick={() => unhide.mutate(undefined)}>
                      Einblenden
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" icon={<EyeOff />} onClick={() => setHiding(true)}>
                      Ausblenden
                    </Button>
                  ))}
                <Button size="sm" variant="ghost" icon={<FileDown />} loading={pdfBusy} onClick={() => pdf(d)}>
                  PDF
                </Button>
              </span>
            </>
          )
        }
      >
        {isLoading ? (
          <div className="flex flex-col gap-3" role="status" aria-label="Lädt">
            <Skeleton className="aspect-[8/3] w-full rounded-lg" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ) : error ? (
          <ErrorBox error={error} onRetry={() => refetch()} />
        ) : (
          d && (
            <div className="[contain:inline-size]">
              {d.hiddenAt && (
                <Notice tone="muted" icon={<EyeOff />} title={`Ausgeblendet ${fmtDate(d.hiddenAt)}${d.hiddenByName ? ` von ${d.hiddenByName}` : ''}`} className="mb-6">
                  {d.hiddenReason}
                </Notice>
              )}
              {(d.photoKey || d.resolutionPhotoKey) && (
                <div className="mb-7">
                  <PhotoPair before={d.photoKey} after={d.resolutionPhotoKey} resolved={resolved} />
                </div>
              )}
              <PanelSection title="Beschreibung">
                <p className="text-body break-words whitespace-pre-line text-ink">{d.note || <span className="text-ink-4">Keine Beschreibung.</span>}</p>
              </PanelSection>
              {d.measure && (
                <PanelSection title="Maßnahme">
                  <p className="text-body break-words text-ink">{d.measure}</p>
                </PanelSection>
              )}
              {resolved && (
                <PanelSection title="Behebung">
                  <div className="border-l-2 border-line pl-3">
                    <p className="text-body break-words text-ink">{d.resolutionNote || <span className="text-ink-3">Ohne Notiz.</span>}</p>
                    <p className="mt-1 text-meta text-ink-3">
                      {fmtDate(d.resolvedAt)}
                      {d.resolvedByName ? ` · ${d.resolvedByName}` : ''}
                    </p>
                  </div>
                </PanelSection>
              )}
              <PanelSection title="Aufgaben">
                {d.tasks.length ? (
                  <ul className="-mx-2 divide-y divide-line">
                    {d.tasks.map((t) => (
                      <li key={t.id}>
                        <Link to={`/aufgaben?id=${t.id}`} className="flex min-h-11 items-center gap-3 rounded-md px-2 py-2 transition-colors hover:bg-hover">
                          <span className="min-w-0 flex-1 truncate text-body">{t.title}</span>
                          <span className="flex shrink-0 items-center gap-1.5 text-meta text-ink-2">
                            <StatusDot tone={t.status === 'done' ? 'ok' : t.status === 'in_progress' ? 'info' : t.status === 'cancelled' ? 'muted' : 'warn'} />
                            {TASK_STATUS[t.status]}
                            {t.assigneeName ? <span className="text-ink-3"> · {t.assigneeName}</span> : ''}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-body text-ink-3">Keine Aufgabe verknüpft.{canEdit && !resolved && !d.hiddenAt ? ' Lege eine an, damit sich jemand kümmert.' : ''}</p>
                )}
              </PanelSection>
              <PanelSection title="Verlauf">
                <Timeline
                  items={d.history.map((h, i) => ({
                    id: String(i),
                    icon: HISTORY_ICON[h.action]?.icon ?? <Pencil />,
                    tone: HISTORY_ICON[h.action]?.tone,
                    title: <span className="break-words">{h.summary}</span>,
                    meta: h.userName ?? undefined,
                    time: <span title={fmtDateTime(h.createdAt)}>{fmtRelative(h.createdAt)}</span>,
                  }))}
                />
              </PanelSection>
            </div>
          )
        )}
      </WorkPanel>
      {hiding && <HideDialog id={id} title={d?.title} onClose={() => setHiding(false)} />}
    </>
  );
}

const REASONS = ['Doppelt erfasst', 'Nicht relevant', 'Fehlerfassung'];

function HideDialog({ id, title, onClose }: { id: string; title?: string; onClose: () => void }) {
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
      size="sm"
      description={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button form="hide-form" icon={<EyeOff />} loading={hide.isPending} disabled={!reason.trim()}>
            Ausblenden
          </Button>
        </>
      }
    >
      <form
        id="hide-form"
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          hide.mutate(undefined);
        }}
      >
        <p className="text-body text-ink-2">Ausgeblendete Mängel zählen nicht mehr mit und stehen nur noch unter „Ausgeblendet“. Du kannst sie jederzeit wieder einblenden.</p>
        {hide.error && <ErrorBox error={hide.error} />}
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <Chip key={r} active={reason === r} onClick={() => setReason(r)}>
              {r}
            </Chip>
          ))}
        </div>
        <Field label="Grund">{(fid) => <Input id={fid} required autoFocus maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </form>
    </Modal>
  );
}


import { getCategory } from '../categories';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ChevronRight, KeyRound, Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { type Category, type Severity } from '../../shared/catalog';
import { api, type Subcontractor, useAction, useMe, useSubcontractors } from '../api';
import { CopyField, PublicPage, SurfaceHead } from '../components/admin';
import {
  Button,
  Empty,
  ErrorBox,
  Field,
  Input,
  Menu,
  Modal,
  Notice,
  PageHeader,
  PropertyList,
  Section,
  SeverityBadge,
  Skeleton,
  SkeletonList,
  StatusText,
  Surface,
  Textarea,
  useConfirm,
  useToast,
} from '../components/ui';
import { fmtDate, fmtDateTime } from '../format';

export function SubcontractorsPage() {
  const { data, isLoading, error, refetch } = useSubcontractors();
  const { data: me } = useMe();
  const [edit, setEdit] = useState<Partial<Subcontractor> | null>(null);
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const isAdmin = !!me && ['owner', 'admin'].includes(me.user.role);
  const del = useAction((id: string) => api(`/subcontractors/${id}`, { method: 'DELETE' }), () => toast('Subunternehmer entfernt'));
  const [partnerLink, setPartnerLink] = useState<{ company: string; link: string } | null>(null);
  const createCode = useAction(
    (s: Subcontractor) => api<{ code: string }>(`/subcontractors/${s.id}/partner-code`, { method: 'POST' }),
    (r, s) => setPartnerLink({ company: s.company, link: `${window.location.origin}/partner/${r.code}` }),
  );
  const revokeCode = useAction((id: string) => api(`/subcontractors/${id}/partner-code`, { method: 'DELETE' }), () => toast('Partner-Zugang widerrufen'));
  const newCode = async (s: Subcontractor) => {
    if (
      s.partnerAccess &&
      !(await confirm({ title: 'Neuen Partner-Link erzeugen?', text: `Der bisherige Link von ${s.company} funktioniert danach nicht mehr.`, confirmLabel: 'Neu erzeugen' }))
    )
      return;
    createCode.mutate(s);
  };
  const open = (data ?? []).reduce((s, x) => s + x.openTasks, 0);
  return (
    <>
      <PageHeader
        title="Subunternehmer"
        subtitle="Fachfirmen für Wartung und Mängelbehebung. Aufgaben teilst du per Link – ohne eigenes Konto."
        actions={
          isAdmin && (
            <Button icon={<Plus />} onClick={() => setEdit({})}>
              Neuer Subunternehmer
            </Button>
          )
        }
      />
      {confirmEl}
      {edit && <SubForm initial={edit} onClose={() => setEdit(null)} />}
      {partnerLink && <PartnerLinkModal {...partnerLink} onClose={() => setPartnerLink(null)} />}
      {(del.error || createCode.error || revokeCode.error) && <ErrorBox error={del.error ?? createCode.error ?? revokeCode.error} className="mb-4" />}
      {isLoading ? (
        <SkeletonList rows={4} />
      ) : error ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : !data?.length ? (
        <Surface>
          <Empty
            title="Noch keine Subunternehmer"
            text="Lege Fachfirmen an, um ihnen Aufgaben per Link zu geben."
            action={
              isAdmin && (
                <Button variant="secondary" icon={<Plus />} onClick={() => setEdit({})}>
                  Subunternehmer anlegen
                </Button>
              )
            }
          />
        </Surface>
      ) : (
        <Surface>
          <Section title="Firmen" count={data.length} action={<span className="text-meta text-ink-3">{open ? `${open} offene Aufgaben` : 'Keine offenen Aufgaben'}</span>} flush>
            <ul className="pk-list" aria-label="Subunternehmer">
              {data.map((s) => (
                <li key={s.id} className="flex min-h-14 items-center gap-3 py-2.5 pr-[calc(var(--row-px)-0.5rem)] pl-(--row-px)">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body text-ink">{s.company}</p>
                    <p className="truncate text-meta text-ink-3">
                      {[s.trade || 'Gewerk nicht angegeben', s.contactName].filter(Boolean).join(' · ')}
                      {s.phone && (
                        <>
                          {' · '}
                          <a className="text-ink-2 hover:text-ink hover:underline" href={`tel:${s.phone}`}>
                            {s.phone}
                          </a>
                        </>
                      )}
                      {s.email && (
                        <>
                          {' · '}
                          <a className="text-ink-2 hover:text-ink hover:underline" href={`mailto:${s.email}`}>
                            {s.email}
                          </a>
                        </>
                      )}
                    </p>
                  </div>
                  <span className="shrink-0 text-meta">
                    {s.openTasks ? <StatusText tone="warn">{s.openTasks} offen</StatusText> : <span className="text-ink-3 tabular-nums">{s.doneTasks} erledigt</span>}
                  </span>
                  {isAdmin && (
                    <Menu
                      label={`Aktionen für ${s.company}`}
                      items={[
                        { label: 'Bearbeiten', icon: <Pencil />, onClick: () => setEdit(s) },
                        { label: s.partnerAccess ? 'Neuen Partner-Link erzeugen' : 'Partner-Zugang einrichten', icon: <KeyRound />, onClick: () => newCode(s) },
                        ...(s.partnerAccess
                          ? [
                              {
                                label: 'Partner-Zugang widerrufen',
                                icon: <KeyRound />,
                                danger: true,
                                onClick: async () => {
                                  if (
                                    await confirm({
                                      title: 'Partner-Zugang widerrufen?',
                                      text: `${s.company} kann die Sammelseite danach nicht mehr öffnen. Einzelne Aufgaben-Links bleiben gültig.`,
                                      confirmLabel: 'Widerrufen',
                                      danger: true,
                                    })
                                  )
                                    revokeCode.mutate(s.id);
                                },
                              },
                            ]
                          : []),
                        'separator',
                        {
                          label: 'Entfernen',
                          icon: <Trash2 />,
                          danger: true,
                          onClick: async () => {
                            if (await confirm({ title: `${s.company} entfernen?`, text: 'Geteilte Aufgaben bleiben erhalten.', confirmLabel: 'Entfernen', danger: true })) del.mutate(s.id);
                          },
                        },
                      ]}
                    />
                  )}
                </li>
              ))}
            </ul>
          </Section>
          {data.some((s) => s.partnerAccess) && (
            <Section title="Partner-Zugänge" flush>
              <p className="-mt-1 mb-2 max-w-2xl px-(--row-px) text-meta text-ink-2">Sammelseite je Firma mit allen offenen Aufträgen – ohne eigenes Konto.</p>
              <ul className="pk-list" aria-label="Partner-Zugänge">
                {data
                  .filter((s) => s.partnerAccess)
                  .map((s) => (
                    <li key={s.id} className="flex min-h-11 flex-col justify-center gap-0.5 px-(--row-px) py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
                      <span className="min-w-0 truncate text-body">{s.company}</span>
                      <PartnerStatus s={s} />
                    </li>
                  ))}
              </ul>
            </Section>
          )}
        </Surface>
      )}
    </>
  );
}

/** Partner-Zugang einer Firma: aktiv seit, zuletzt genutzt. */
function PartnerStatus({ s }: { s: Subcontractor }) {
  if (!s.partnerAccess) return null;
  return (
    <span className="min-w-0 text-meta text-ink-3 sm:shrink-0 sm:text-right" data-partner-status>
      Aktiv{s.partnerCreatedAt ? ` seit ${fmtDate(s.partnerCreatedAt)}` : ''} · {s.partnerUsedAt ? `zuletzt genutzt ${fmtDateTime(s.partnerUsedAt)}` : 'noch nicht genutzt'}
    </span>
  );
}

/** Neuer Partner-Link – wird nur dieses eine Mal angezeigt (gespeichert ist nur der Hash). */
function PartnerLinkModal({ company, link, onClose }: { company: string; link: string; onClose: () => void }) {
  return (
    <Modal
      title="Partner-Zugang"
      description={company}
      onClose={onClose}
      footer={
        <Button variant="secondary" onClick={onClose}>
          Fertig
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-body text-ink-2">
          Über diesen Link sieht {company} ohne eigenes Konto alle offenen Aufträge, die der Firma zugewiesen sind, und gibt je Auftrag Rückmeldung. Interne Notizen und Namen
          bleiben verborgen.
        </p>
        <Notice tone="warn" title="Jetzt kopieren">
          Der Link wird nur einmal angezeigt. Bei Verlust einen neuen erzeugen – der alte verliert dann seine Gültigkeit.
        </Notice>
        <CopyField value={link} label="Partner-Link" />
      </div>
    </Modal>
  );
}

function SubForm({ initial, onClose }: { initial: Partial<Subcontractor>; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({
    company: initial.company ?? '',
    contactName: initial.contactName ?? '',
    email: initial.email ?? '',
    phone: initial.phone ?? '',
    trade: initial.trade ?? '',
    notes: initial.notes ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = useAction(
    () => (initial.id ? api(`/subcontractors/${initial.id}`, { method: 'PATCH', body: f }) : api('/subcontractors', { body: f })),
    () => {
      toast('Gespeichert');
      onClose();
    },
  );
  return (
    <Modal
      title={initial.id ? 'Subunternehmer bearbeiten' : 'Neuer Subunternehmer'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button form="sub-form" loading={save.isPending}>
            Speichern
          </Button>
        </>
      }
    >
      <form
        id="sub-form"
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
        <Field label="Firma" className="sm:col-span-2">
          {(id) => <Input id={id} required autoFocus value={f.company} onChange={set('company')} />}
        </Field>
        <Field label="Gewerk" optional>
          {(id) => <Input id={id} value={f.trade} onChange={set('trade')} placeholder="z. B. Türtechnik" />}
        </Field>
        <Field label="Ansprechperson" optional>
          {(id) => <Input id={id} value={f.contactName} onChange={set('contactName')} />}
        </Field>
        <Field label="Telefon" optional>
          {(id) => <Input id={id} type="tel" value={f.phone} onChange={set('phone')} />}
        </Field>
        <Field label="E-Mail" optional>
          {(id) => <Input id={id} type="email" value={f.email} onChange={set('email')} />}
        </Field>
        <Field label="Notizen" optional className="sm:col-span-2">
          {(id) => <Textarea id={id} value={f.notes} onChange={set('notes')} />}
        </Field>
      </form>
    </Modal>
  );
}

// ---------- Externe Ansicht (ohne Login) ----------
interface ExternalTask {
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  dueAt: number | null;
  externalNote: string;
  externalDoneAt: number | null;
  tenantName: string;
  subcontractorName: string | null;
  assetCode: string | null;
  category: Category | null;
  location: string | null;
  floor: string | null;
  buildingName: string | null;
  propertyName: string | null;
  propertyAddress: string | null;
  defectTitle: string | null;
  defectSeverity: Severity | null;
  defectNote: string | null;
  defectMeasure: string | null;
  legalBasis: string | null;
  hasPhoto: boolean;
}

const STATUS = {
  open: { label: 'Offen', tone: 'warn' },
  in_progress: { label: 'In Arbeit', tone: 'info' },
  done: { label: 'Erledigt', tone: 'ok' },
  cancelled: { label: 'Abgebrochen', tone: 'muted' },
} as const;

export function ExternalTaskPage() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['ext', token], queryFn: () => api<ExternalTask>(`/public/tasks/${token}`), retry: false });
  const t = q.data;
  return (
    <PublicPage context={t ? `Auftrag von ${t.tenantName}` : undefined}>
      {q.isLoading ? (
        <DetailSkeleton />
      ) : !t ? (
        <Invalid title="Link ungültig" text="Diese Aufgabe ist nicht mehr freigegeben. Bitte wende dich an deinen Auftraggeber." />
      ) : (
        <ExternalTaskDetail
          t={t}
          photoUrl={`/api/public/tasks/${token}/photo`}
          send={async (status, note) => {
            await api(`/public/tasks/${token}`, { body: { status, note } });
            await q.refetch();
          }}
        />
      )}
    </PublicPage>
  );
}

/** Ungültiger Link: ein Satz in der Fläche, wie bei der Anmeldung. */
function Invalid({ title, text }: { title: string; text: string }) {
  return (
    <Surface className="max-w-[400px] px-5 py-7 sm:px-8 sm:py-9">
      <h1 className="text-h1 font-semibold tracking-[-0.02em]">{title}</h1>
      <p className="mt-1.5 text-body text-ink-2">{text}</p>
    </Surface>
  );
}

function DetailSkeleton() {
  return (
    <Surface className="flex flex-col gap-3 p-(--row-px) sm:p-8" role="status" aria-label="Lädt">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-8 w-72 max-w-full" />
      <Skeleton className="mt-4 h-40 w-full" />
    </Surface>
  );
}

/** Auftrag für Externe: Angaben, Mangel, Rückmeldung (Einzel-Link und Partner-Seite). */
function ExternalTaskDetail({ t, photoUrl, send }: { t: ExternalTask; photoUrl: string; send: (status: 'in_progress' | 'done', note: string) => Promise<void> }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'in_progress' | 'done' | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const submit = async (status: 'in_progress' | 'done') => {
    setBusy(status);
    setErr(null);
    try {
      await send(status, note);
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };
  const overdue = !!t.dueAt && t.dueAt < Date.now() && t.status !== 'done';
  return (
    <Surface>
      <SurfaceHead
        eyebrow={t.subcontractorName ? `Für ${t.subcontractorName}` : `Auftrag von ${t.tenantName}`}
        title={t.title}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
            <StatusText tone={STATUS[t.status].tone}>{STATUS[t.status].label}</StatusText>
            {t.dueAt && (
              <span className={overdue ? 'text-shu' : 'text-ink-3'}>
                {overdue ? 'Überfällig seit' : 'Fällig am'} <span className="tabular-nums">{fmtDate(t.dueAt)}</span>
              </span>
            )}
            <span className="text-ink-3">Priorität {{ low: 'niedrig', medium: 'mittel', high: 'hoch' }[t.priority]}</span>
          </span>
        }
      />
      <Section title="Ort">
        <PropertyList
          items={[
            ...(t.propertyName
              ? [
                  {
                    label: 'Objekt',
                    value: (
                      <>
                        {t.propertyName}
                        {t.propertyAddress && <span className="block font-normal text-ink-2">{t.propertyAddress.split('\n').join(', ')}</span>}
                      </>
                    ),
                  },
                ]
              : []),
            ...(t.assetCode
              ? [
                  { label: 'Element', value: `${t.assetCode}${t.category ? ` · ${getCategory(t.category).label}` : ''}` },
                  { label: 'Standort', value: [t.buildingName, t.floor, t.location].filter(Boolean).join(' · ') },
                ]
              : []),
          ]}
        />
        {t.description && <p className="mt-4 text-body whitespace-pre-line text-ink-2">{t.description}</p>}
      </Section>

      {t.defectTitle && (
        <Section title="Mangel" action={t.defectSeverity && <SeverityBadge severity={t.defectSeverity} />}>
          <div className="flex flex-col gap-2 text-body">
            <p>{t.defectTitle}</p>
            {t.defectNote && <p className="text-ink-2">{t.defectNote}</p>}
            {t.defectMeasure && (
              <p className="text-ink-2">
                <span className="text-ink-3">Maßnahme: </span>
                {t.defectMeasure}
              </p>
            )}
            {t.legalBasis && <p className="text-meta text-ink-3">{t.legalBasis}</p>}
            {t.hasPhoto && <img src={photoUrl} alt="Foto zum Mangel" className="mt-2 max-h-80 self-start rounded-md border border-line object-contain" />}
          </div>
        </Section>
      )}

      {t.status === 'done' ? (
        <Section title="Rückmeldung">
          <div className="text-body">
            <StatusText tone="ok" className="text-body">
              Als erledigt gemeldet {t.externalDoneAt && `am ${fmtDateTime(t.externalDoneAt)}`}
            </StatusText>
            {t.externalNote && <p className="mt-2 text-ink-2">{t.externalNote}</p>}
            <p className="mt-2 text-meta text-ink-3">Danke. {t.tenantName} sieht deine Rückmeldung.</p>
          </div>
        </Section>
      ) : (
        <Section title="Rückmeldung">
          <div className="flex flex-col gap-4">
            <p className="-mt-1 text-meta text-ink-2">{t.tenantName} sieht deine Notiz sofort.</p>
            {!!err && <ErrorBox error={err} />}
            <Field label="Rückmeldung" hint="Was wurde gemacht? Material, Hinweise …">
              {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
            </Field>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              {t.status === 'open' && (
                <Button variant="secondary" size="lg" className="sm:h-10 sm:text-body" loading={busy === 'in_progress'} disabled={!!busy} onClick={() => submit('in_progress')}>
                  In Arbeit
                </Button>
              )}
              <Button size="lg" className="sm:h-10 sm:text-body" loading={busy === 'done'} disabled={!!busy} onClick={() => submit('done')}>
                Als erledigt melden
              </Button>
            </div>
          </div>
        </Section>
      )}
    </Surface>
  );
}

// ---------- Partner-Seite: alle offenen Aufträge einer Firma (Einladungscode, ohne Login) ----------
type PartnerTask = ExternalTask & { ref: string };
interface PartnerView {
  company: string;
  tenantName: string;
  tasks: PartnerTask[];
}

export function PartnerPage() {
  const { code = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const ref = params.get('auftrag');
  const q = useQuery({ queryKey: ['partner', code], queryFn: () => api<PartnerView>(`/public/partner/${code}`), retry: false });
  const [reported, setReported] = useState<string | null>(null);
  const v = q.data;
  const t = v?.tasks.find((x) => x.ref === ref) ?? null;
  const open = (r: string | null) => {
    setParams(r ? { auftrag: r } : {});
    window.scrollTo(0, 0);
  };
  return (
    <PublicPage context={v ? `Aufträge von ${v.tenantName}` : undefined}>
      {q.isLoading ? (
        <DetailSkeleton />
      ) : !v ? (
        <Invalid title="Zugang ungültig" text="Dieser Partner-Link gilt nicht mehr. Bitte wende dich an deinen Auftraggeber." />
      ) : t ? (
        <div className="flex flex-col gap-3">
          <button type="button" onClick={() => open(null)} className="inline-flex min-h-9 items-center gap-1.5 self-start text-meta font-medium text-ink-2 hover:text-ink">
            <ArrowLeft className="size-4" />
            Alle Aufträge
          </button>
          <ExternalTaskDetail
            key={t.ref}
            t={t}
            photoUrl={`/api/public/partner/${code}/tasks/${t.ref}/photo`}
            send={async (status, note) => {
              await api(`/public/partner/${code}/tasks/${t.ref}`, { body: { status, note } });
              if (status === 'done') {
                setReported(t.title);
                open(null);
              }
              await q.refetch();
            }}
          />
        </div>
      ) : (
        <Surface>
          <SurfaceHead
            eyebrow={`Partner-Zugang von ${v.tenantName}`}
            title={v.company}
            meta={v.tasks.length ? `${v.tasks.length} offene ${v.tasks.length === 1 ? 'Auftrag' : 'Aufträge'}` : 'Keine offenen Aufträge'}
          />
          {(reported || (ref && !t)) && (
            <div className="flex flex-col gap-2 px-(--row-px) pb-5">
              {reported && (
                <StatusText tone="ok" className="text-body">
                  Als erledigt gemeldet: „{reported}“ – {v.tenantName} sieht deine Rückmeldung.
                </StatusText>
              )}
              {ref && !t && <Notice tone="warn">Dieser Auftrag ist nicht mehr offen.</Notice>}
            </div>
          )}
          {v.tasks.length === 0 ? (
            <Section>
              <p className="text-body text-ink-2">Alles erledigt. Neue Aufträge erscheinen hier, sobald sie deiner Firma zugewiesen werden.</p>
            </Section>
          ) : (
            <Section title="Offene Aufträge" count={v.tasks.length} flush>
              <ul className="pk-list" aria-label="Offene Aufträge">
                {v.tasks.map((x) => {
                  const overdue = !!x.dueAt && x.dueAt < Date.now();
                  return (
                    <li key={x.ref}>
                      <Link
                        to={`?auftrag=${x.ref}`}
                        onClick={(e) => {
                          e.preventDefault();
                          open(x.ref);
                        }}
                        className="group flex min-h-14 items-center gap-3 px-(--row-px) py-2.5 hover:bg-hover"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-body break-words text-ink">{x.title}</p>
                          <p className="text-meta break-words text-ink-3">
                            {[x.assetCode, x.propertyName, x.buildingName].filter(Boolean).join(' · ') || 'Ohne Ortsangabe'} · {STATUS[x.status].label}
                          </p>
                        </div>
                        {x.dueAt && <span className={overdue ? 'shrink-0 text-meta text-shu tabular-nums' : 'shrink-0 text-meta text-ink-3 tabular-nums'}>{fmtDate(x.dueAt)}</span>}
                        <ChevronRight className="size-4 shrink-0 text-ink-4" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Section>
          )}
        </Surface>
      )}
    </PublicPage>
  );
}

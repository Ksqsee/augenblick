import { getCategory } from '../categories';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, HardHat, Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { type Category, type Severity } from '../../shared/catalog';
import { api, type Subcontractor, useAction, useMe, useSubcontractors } from '../api';
import { PublicHeader } from '../components/admin';
import { Logo } from '../components/Logo';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Empty,
  ErrorBox,
  Field,
  Input,
  Menu,
  Modal,
  PageHeader,
  PropertyList,
  RowIcon,
  SectionHeader,
  SeverityBadge,
  Skeleton,
  SkeletonList,
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
      {del.error && <ErrorBox error={del.error} className="mb-4" />}
      {isLoading ? (
        <SkeletonList rows={4} />
      ) : error ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : !data?.length ? (
        <Card>
          <Empty
            icon={<HardHat />}
            title="Noch keine Subunternehmer"
            text="Lege Fachfirmen an, um ihnen Aufgaben per Link zu geben."
            action={
              isAdmin && (
                <Button icon={<Plus />} onClick={() => setEdit({})}>
                  Subunternehmer anlegen
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <>
          <SectionHeader title="Firmen" count={data.length} meta={open ? `${open} offene Aufgaben` : 'Keine offenen Aufgaben'} />
          <Card className="overflow-hidden">
            <ul className="divide-y divide-line">
              {data.map((s) => (
                <li key={s.id} className="flex items-start gap-3 px-4 py-3 sm:items-center">
                  <RowIcon>
                    <HardHat />
                  </RowIcon>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium">{s.company}</p>
                    <p className="truncate text-meta text-ink-3">{[s.trade || 'Gewerk nicht angegeben', s.contactName].filter(Boolean).join(' · ')}</p>
                    {(s.phone || s.email) && (
                      <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-meta">
                        {s.phone && (
                          <a className="inline-flex min-h-6 items-center gap-1.5 text-ink-2 hover:text-ink hover:underline" href={`tel:${s.phone}`}>
                            <Phone className="size-3.5 text-ink-3" />
                            {s.phone}
                          </a>
                        )}
                        {s.email && (
                          <a className="inline-flex min-h-6 min-w-0 items-center gap-1.5 break-all text-ink-2 hover:text-ink hover:underline" href={`mailto:${s.email}`}>
                            <Mail className="size-3.5 shrink-0 text-ink-3" />
                            {s.email}
                          </a>
                        )}
                      </p>
                    )}
                    <span className="mt-1.5 flex gap-1.5 sm:hidden">
                      <TaskCounts s={s} />
                    </span>
                  </div>
                  <span className="hidden shrink-0 gap-1.5 sm:flex">
                    <TaskCounts s={s} />
                  </span>
                  {isAdmin && (
                    <Menu
                      label={`Aktionen für ${s.company}`}
                      items={[
                        { label: 'Bearbeiten', icon: <Pencil />, onClick: () => setEdit(s) },
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
          </Card>
        </>
      )}
    </>
  );
}

function TaskCounts({ s }: { s: Subcontractor }) {
  return (
    <>
      <Badge tone={s.openTasks ? 'warn' : 'muted'} dot={!!s.openTasks}>
        {s.openTasks} offen
      </Badge>
      <Badge tone="muted">{s.doneTasks} erledigt</Badge>
    </>
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
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<'in_progress' | 'done' | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const send = async (status: 'in_progress' | 'done') => {
    setBusy(status);
    setErr(null);
    try {
      await api(`/public/tasks/${token}`, { body: { status, note } });
      await q.refetch();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };
  const t = q.data;
  const overdue = !!t?.dueAt && t.dueAt < Date.now() && t.status !== 'done';
  return (
    <div className="min-h-dvh bg-canvas">
      <PublicHeader>
        <Logo />
        {t && <span className="min-w-0 truncate border-l border-line pl-3 text-meta text-ink-3">Auftrag von {t.tenantName}</span>}
      </PublicHeader>
      <main className="mx-auto max-w-xl px-4 py-8 sm:py-10">
        {q.isLoading ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-8 w-72" />
            <Skeleton className="mt-4 h-40 w-full rounded-xl" />
          </div>
        ) : !t ? (
          <Card>
            <Empty icon={<HardHat />} title="Link ungültig" text="Diese Aufgabe ist nicht mehr freigegeben. Bitte wende dich an deinen Auftraggeber." />
          </Card>
        ) : (
          <div className="flex flex-col gap-6">
            <div>
              <p className="text-meta text-ink-3">{t.subcontractorName ? `Für ${t.subcontractorName}` : `Auftrag von ${t.tenantName}`}</p>
              <h1 className="mt-1 text-h1 font-semibold tracking-[-0.02em]">{t.title}</h1>
              <div className="mt-3 flex flex-wrap gap-2">
                <Badge tone={STATUS[t.status].tone} dot>
                  {STATUS[t.status].label}
                </Badge>
                {t.dueAt && (
                  <Badge tone={overdue ? 'bad' : 'muted'} variant={overdue ? 'soft' : 'outline'}>
                    {overdue ? 'Überfällig seit' : 'Fällig am'} {fmtDate(t.dueAt)}
                  </Badge>
                )}
                <Badge variant="outline" tone={t.priority === 'high' ? 'bad' : 'muted'}>
                  Priorität {{ low: 'niedrig', medium: 'mittel', high: 'hoch' }[t.priority]}
                </Badge>
              </div>
            </div>

            <Card className="p-4 sm:p-5">
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
              {t.description && <p className="mt-4 border-t border-line pt-4 text-body whitespace-pre-line text-ink-2">{t.description}</p>}
            </Card>

            {t.defectTitle && (
              <Card>
                <CardHeader title="Mangel" action={t.defectSeverity && <SeverityBadge severity={t.defectSeverity} />} />
                <div className="flex flex-col gap-2 px-4 pb-4 text-body sm:px-5 sm:pb-5">
                  <p className="font-medium">{t.defectTitle}</p>
                  {t.defectNote && <p className="text-ink-2">{t.defectNote}</p>}
                  {t.defectMeasure && (
                    <p className="text-ink-2">
                      <span className="text-ink-3">Maßnahme: </span>
                      {t.defectMeasure}
                    </p>
                  )}
                  {t.legalBasis && <p className="text-meta text-ink-3">{t.legalBasis}</p>}
                  {t.hasPhoto && <img src={`/api/public/tasks/${token}/photo`} alt="Foto zum Mangel" className="mt-2 max-h-80 rounded-lg border border-line object-contain" />}
                </div>
              </Card>
            )}

            {t.status === 'done' ? (
              <Card className="flex items-start gap-3 p-4 sm:p-5">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ok-soft text-ok">
                  <CheckCircle2 className="size-5" />
                </span>
                <div className="text-body">
                  <p className="font-medium">Als erledigt gemeldet {t.externalDoneAt && `am ${fmtDateTime(t.externalDoneAt)}`}</p>
                  {t.externalNote && <p className="mt-1 text-ink-2">{t.externalNote}</p>}
                  <p className="mt-1 text-meta text-ink-3">Danke! {t.tenantName} sieht deine Rückmeldung.</p>
                </div>
              </Card>
            ) : (
              <Card className="flex flex-col gap-4 p-4 sm:p-5">
                <div>
                  <h2 className="text-title font-semibold">Rückmeldung geben</h2>
                  <p className="text-meta text-ink-3">{t.tenantName} sieht deine Notiz sofort.</p>
                </div>
                {!!err && <ErrorBox error={err} />}
                <Field label="Rückmeldung" hint="Was wurde gemacht? Material, Hinweise …">
                  {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
                </Field>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  {t.status === 'open' && (
                    <Button variant="secondary" size="lg" className="sm:h-10 sm:text-body" loading={busy === 'in_progress'} disabled={!!busy} onClick={() => send('in_progress')}>
                      In Arbeit
                    </Button>
                  )}
                  <Button size="lg" className="sm:h-10 sm:text-body" loading={busy === 'done'} disabled={!!busy} icon={<CheckCircle2 />} onClick={() => send('done')}>
                    Als erledigt melden
                  </Button>
                </div>
              </Card>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

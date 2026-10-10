import { getCategory } from '../categories';
import { useQuery } from '@tanstack/react-query';
import { Building, CheckCircle2, HardHat, Mail, Pencil, Phone, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { type Category, SEVERITIES, type Severity } from '../../shared/catalog';
import { api, type Subcontractor, useAction, useMe, useSubcontractors } from '../api';
import { Logo } from '../components/Logo';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Spinner, Textarea, useToast } from '../components/ui';
import { fmtDate, fmtDateTime } from '../format';

export function SubcontractorsPage() {
  const { data, isLoading, error } = useSubcontractors();
  const { data: me } = useMe();
  const [edit, setEdit] = useState<Partial<Subcontractor> | null>(null);
  const toast = useToast();
  const isAdmin = me && ['owner', 'admin'].includes(me.user.role);
  const del = useAction((id: string) => api(`/subcontractors/${id}`, { method: 'DELETE' }), () => toast('Entfernt'));
  return (
    <>
      <PageHeader
        title="Subunternehmer"
        subtitle="Fachfirmen für Wartung und Mängelbehebung. Aufgaben teilst du per Link – ohne eigenes Konto."
        actions={
          isAdmin && (
            <Button icon={<Plus className="size-4" />} onClick={() => setEdit({})}>
              Neuer Subunternehmer
            </Button>
          )
        }
      />
      {edit && <SubForm initial={edit} onClose={() => setEdit(null)} />}
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : !data?.length ? (
        <Card>
          <Empty icon={<HardHat className="size-5" />} title="Noch keine Subunternehmer" text="Lege Fachfirmen an, um ihnen Aufgaben zuzuweisen." />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {data.map((s) => (
            <Card key={s.id} className="flex flex-col p-5">
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-sunken text-ink-2">
                  <Building className="size-5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{s.company}</p>
                  <p className="truncate text-xs text-ink-3">{s.trade || 'Gewerk nicht angegeben'}</p>
                </div>
                {isAdmin && (
                  <div className="flex">
                    <Button size="sm" variant="ghost" aria-label="Bearbeiten" onClick={() => setEdit(s)}>
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Löschen" onClick={() => confirm(`${s.company} entfernen?`) && del.mutate(s.id)}>
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                )}
              </div>
              <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ink-2">
                {s.contactName && <li>{s.contactName}</li>}
                {s.phone && (
                  <li>
                    <a className="inline-flex items-center gap-2 hover:underline" href={`tel:${s.phone}`}>
                      <Phone className="size-3.5 text-ink-3" />
                      {s.phone}
                    </a>
                  </li>
                )}
                {s.email && (
                  <li>
                    <a className="inline-flex items-center gap-2 break-all hover:underline" href={`mailto:${s.email}`}>
                      <Mail className="size-3.5 text-ink-3" />
                      {s.email}
                    </a>
                  </li>
                )}
              </ul>
              <div className="mt-4 flex gap-2 border-t border-line pt-3">
                <Badge tone={s.openTasks ? 'warn' : 'muted'}>{s.openTasks} offen</Badge>
                <Badge tone="ok">{s.doneTasks} erledigt</Badge>
              </div>
            </Card>
          ))}
        </div>
      )}
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
          <Button variant="ghost" onClick={onClose}>
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
        <Field label="Gewerk">{(id) => <Input id={id} value={f.trade} onChange={set('trade')} placeholder="z. B. Türtechnik" />}</Field>
        <Field label="Ansprechperson">{(id) => <Input id={id} value={f.contactName} onChange={set('contactName')} />}</Field>
        <Field label="Telefon">{(id) => <Input id={id} type="tel" value={f.phone} onChange={set('phone')} />}</Field>
        <Field label="E-Mail">{(id) => <Input id={id} type="email" value={f.email} onChange={set('email')} />}</Field>
        <Field label="Notizen" className="sm:col-span-2">
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

export function ExternalTaskPage() {
  const { token = '' } = useParams();
  const q = useQuery({ queryKey: ['ext', token], queryFn: () => api<ExternalTask>(`/public/tasks/${token}`), retry: false });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const send = async (status: 'in_progress' | 'done') => {
    setBusy(true);
    setErr(null);
    try {
      await api(`/public/tasks/${token}`, { body: { status, note } });
      await q.refetch();
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(false);
    }
  };
  const t = q.data;
  return (
    <div className="min-h-dvh bg-canvas px-4 py-8">
      <div className="mx-auto max-w-xl">
        <Logo />
        {q.isLoading ? (
          <Spinner />
        ) : !t ? (
          <Card className="mt-6">
            <Empty icon={<HardHat className="size-5" />} title="Link ungültig" text="Diese Aufgabe ist nicht mehr freigegeben. Bitte wende dich an deinen Auftraggeber." />
          </Card>
        ) : (
          <div className="mt-6 flex flex-col gap-4">
            <div>
              <p className="text-sm text-ink-3">
                Auftrag von {t.tenantName}
                {t.subcontractorName && ` an ${t.subcontractorName}`}
              </p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight">{t.title}</h1>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone={t.status === 'done' ? 'ok' : t.status === 'in_progress' ? 'info' : 'warn'}>
                  {{ open: 'Offen', in_progress: 'In Arbeit', done: 'Erledigt', cancelled: 'Abgebrochen' }[t.status]}
                </Badge>
                {t.dueAt && <Badge tone={t.dueAt < Date.now() && t.status !== 'done' ? 'bad' : 'muted'}>fällig {fmtDate(t.dueAt)}</Badge>}
                <Badge tone={t.priority === 'high' ? 'bad' : 'muted'}>Priorität {{ low: 'niedrig', medium: 'mittel', high: 'hoch' }[t.priority]}</Badge>
              </div>
            </div>
            <Card className="p-5 text-sm">
              <dl className="grid grid-cols-[110px_1fr] gap-y-2">
                {t.propertyName && (
                  <>
                    <dt className="text-ink-3">Objekt</dt>
                    <dd className="font-medium">
                      {t.propertyName}
                      {t.propertyAddress && <span className="block font-normal text-ink-2">{t.propertyAddress.split('\n').join(', ')}</span>}
                    </dd>
                  </>
                )}
                {t.assetCode && (
                  <>
                    <dt className="text-ink-3">Element</dt>
                    <dd className="font-medium">
                      {t.assetCode} {t.category && <span className="font-normal text-ink-2">· {getCategory(t.category).label}</span>}
                    </dd>
                    <dt className="text-ink-3">Standort</dt>
                    <dd>{[t.buildingName, t.floor, t.location].filter(Boolean).join(' · ') || '–'}</dd>
                  </>
                )}
                {t.defectTitle && (
                  <>
                    <dt className="text-ink-3">Mangel</dt>
                    <dd>
                      <span className="font-medium">{t.defectTitle}</span>
                      {t.defectSeverity && <span className="text-ink-2"> · {SEVERITIES[t.defectSeverity]}</span>}
                      {t.legalBasis && <span className="block text-xs text-ink-3">{t.legalBasis}</span>}
                      {t.defectNote && <span className="block text-ink-2">{t.defectNote}</span>}
                      {t.defectMeasure && <span className="block text-ink-2">Maßnahme: {t.defectMeasure}</span>}
                    </dd>
                  </>
                )}
              </dl>
              {t.description && <p className="mt-4 border-t border-line pt-4 whitespace-pre-line text-ink-2">{t.description}</p>}
              {t.hasPhoto && <img src={`/api/public/tasks/${token}/photo`} alt="Foto zum Mangel" className="mt-4 max-h-80 rounded-lg border border-line" />}
            </Card>
            {t.status === 'done' ? (
              <Card className="flex items-start gap-3 p-5">
                <CheckCircle2 className="size-5 text-ok" />
                <div className="text-sm">
                  <p className="font-medium">Als erledigt gemeldet {t.externalDoneAt && `am ${fmtDateTime(t.externalDoneAt)}`}</p>
                  {t.externalNote && <p className="mt-1 text-ink-2">{t.externalNote}</p>}
                </div>
              </Card>
            ) : (
              <Card className="flex flex-col gap-3 p-5">
                {!!err && <ErrorBox error={err} />}
                <Field label="Rückmeldung" hint="Was wurde gemacht? Material, Hinweise …">
                  {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} />}
                </Field>
                <div className="flex flex-wrap gap-2">
                  {t.status === 'open' && (
                    <Button variant="secondary" loading={busy} onClick={() => send('in_progress')}>
                      In Arbeit
                    </Button>
                  )}
                  <Button loading={busy} icon={<CheckCircle2 className="size-4" />} onClick={() => send('done')}>
                    Als erledigt melden
                  </Button>
                </div>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

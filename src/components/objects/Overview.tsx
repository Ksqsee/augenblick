// Reiter „Übersicht“ des Objekts (Plan v8 Z): Stammdaten, Prüfstatus in Zahlen, Grundrisse, Dateien,
// Brandschutzbeauftragte/r – eine Fläche mit Abschnitten. Alles kommt aus GET /properties/:id (kein weiterer Aufruf beim
// Öffnen); das Berichtsarchiv des Objekts wird erst geladen, wenn man es aufklappt.
import { ChevronDown, Download, Mail, Phone, Upload, User } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { Link } from 'react-router-dom';
import { BUILDING_TYPES } from '../../../shared/walkthrough';
import { api, type Asset, type FireOfficer, fileUrl, type PropertyDetail, useAction, useReports } from '../../api';
import { fmtDate, fmtDateTime } from '../../format';
import { MappeButton } from '../Mappe';
import { PropertyReportButton } from '../PropertyReportButton';
import { Button, ErrorBox, Field, Input, Modal, Section, SkeletonList, StatusDot, Surface, Textarea, useConfirm, useToast } from '../ui';
import { countDue, DuePhrase } from './status';


export function Overview({ p, isAdmin, canInspect, onEdit, onUpload }: { p: PropertyDetail; isAdmin: boolean; canInspect: boolean; onEdit: () => void; onUpload: () => void }) {
  return (
    <Surface data-detail-surface>
      <Facts p={p} isAdmin={isAdmin} onEdit={onEdit} />
      <Numbers p={p} />
      <PlansSection p={p} canUpload={isAdmin} onUpload={onUpload} />
      <Files p={p} canInspect={canInspect} />
      <FireOfficers propertyId={p.id} officers={p.fireOfficers ?? []} canEdit={isAdmin} />
    </Surface>
  );
}

/** Stammdaten: Adresse, Nutzung, Zugang, Ansprechperson – Bearbeiten öffnet das Formular an Ort und Stelle. */
function Facts({ p, isAdmin, onEdit }: { p: PropertyDetail; isAdmin: boolean; onEdit: () => void }) {
  const rows: [string, ReactNode][] = [];
  rows.push(['Adresse', p.address ? <span className="whitespace-pre-line">{p.address}</span> : <span className="text-ink-3">–</span>]);
  rows.push(['Nutzung', BUILDING_TYPES[p.buildingType] ?? '–']);
  if (p.buildings.length > 1) rows.push(['Gebäude', p.buildings.map((b) => b.name).join(', ')]);
  rows.push([
    'Ansprechperson',
    p.contactName || p.contactPhone || p.contactEmail ? (
      <span className="flex flex-col gap-0.5">
        {p.contactName && (
          <span className="inline-flex items-center gap-2">
            <User className="size-3.5 shrink-0 text-ink-3" />
            {p.contactName}
          </span>
        )}
        {p.contactPhone && (
          <a href={`tel:${p.contactPhone}`} className="inline-flex items-center gap-2 hover:underline hover:decoration-line-strong hover:underline-offset-4">
            <Phone className="size-3.5 shrink-0 text-ink-3" />
            {p.contactPhone}
          </a>
        )}
        {p.contactEmail && (
          <a href={`mailto:${p.contactEmail}`} className="inline-flex min-w-0 items-center gap-2 hover:underline hover:decoration-line-strong hover:underline-offset-4">
            <Mail className="size-3.5 shrink-0 text-ink-3" />
            <span className="truncate">{p.contactEmail}</span>
          </a>
        )}
      </span>
    ) : (
      <span className="text-ink-3">Keine hinterlegt</span>
    ),
  ]);
  if (p.access) rows.push(['Zugang', <span className="whitespace-pre-line" data-access>{p.access}</span>]);
  if (p.description) rows.push(['Hinweise', <span className="whitespace-pre-line">{p.description}</span>]);
  return (
    <Section
      title="Stammdaten"
      aria-label="Stammdaten"
      action={
        isAdmin && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Bearbeiten
          </Button>
        )
      }
    >
      <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex min-w-0 flex-col gap-0.5 border-t border-line py-2.5 sm:flex-row sm:gap-4">
            <dt className="shrink-0 text-meta text-ink-3 sm:w-32 sm:pt-px">{k}</dt>
            <dd className="min-w-0 text-body break-words text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}

/** Prüfstatus in vier Zahlen: Elemente, aktuell, fällig, Mängel offen – und das dringendste Element. */
function Numbers({ p }: { p: PropertyDetail }) {
  const due = countDue(p.assets);
  const openDefects = p.assets.reduce((s, a) => s + a.openDefects, 0);
  const fällig = due.overdue + due.soon;
  const next = p.assets.reduce<Asset | null>((m, a) => (a.nextDueAt != null && a.lastResult !== 'not_inspectable' && (!m || a.nextDueAt < (m.nextDueAt ?? Infinity)) ? a : m), null);
  const cells: { key: string; label: string; n: number; to: string; sub?: ReactNode; bad?: boolean }[] = [
    { key: 'assets', label: 'Elemente', n: p.assets.length, to: `/objekte/${p.id}?tab=elemente`, sub: due.never ? `${due.never} nie geprüft` : undefined },
    { key: 'ok', label: 'Aktuell', n: due.ok, to: `/objekte/${p.id}?tab=elemente&stand=aktuell` },
    {
      key: 'due',
      label: 'Fällig',
      n: fällig,
      to: `/objekte/${p.id}?tab=elemente&stand=faellig`,
      sub: due.overdue ? <span className="text-shu">{due.overdue} überfällig</span> : due.soon ? 'in den nächsten 30 Tagen' : undefined,
      bad: due.overdue > 0,
    },
    { key: 'defects', label: 'Mängel offen', n: openDefects, to: `/objekte/${p.id}?tab=maengel` },
  ];
  const label = `Prüfstatus: ${p.assets.length} Elemente, ${due.ok} aktuell, ${fällig} fällig${due.overdue ? ` (${due.overdue} überfällig)` : ''}, ${openDefects} Mängel offen`;
  return (
    <Section title="Prüfstatus" aria-label="Prüfstatus">
      <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-4" aria-label={label}>
        {cells.map((c) => (
          <li key={c.key} className="bg-surface">
            <Link to={c.to} className="group flex h-full flex-col gap-0.5 px-3 py-3 transition-colors hover:bg-hover sm:px-4">
              <span className="text-meta text-ink-3">{c.label}</span>
              <span className={c.bad ? 'text-h2 font-semibold text-shu tabular-nums' : 'text-h2 font-semibold text-ink tabular-nums'} data-number={c.key}>
                {c.n}
              </span>
              {c.sub && <span className="text-meta text-ink-3">{c.sub}</span>}
            </Link>
          </li>
        ))}
      </ul>
      {next && (
        <Link to={`/elemente/${next.id}`} className="group mt-4 flex min-w-0 flex-wrap items-baseline gap-x-2 text-body">
          <span className="text-meta text-ink-3">Am dringendsten</span>
          <span className="min-w-0 truncate text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">
            <span className="font-medium">{next.code}</span>
            {next.location && <span className="text-ink-3"> · {next.location}</span>}
          </span>
          <DuePhrase asset={next} className="text-meta" />
        </Link>
      )}
    </Section>
  );
}

function PlansSection({ p, canUpload, onUpload }: { p: PropertyDetail; canUpload: boolean; onUpload: () => void }) {
  const upload = canUpload && p.buildings.length > 0 && (
    <Button size="sm" variant="ghost" icon={<Upload />} onClick={onUpload}>
      Grundriss hochladen
    </Button>
  );
  if (!p.floorPlans.length)
    return (
      <Section id="grundrisse" title="Grundrisse" aria-label="Grundrisse" action={upload}>
        <p className="text-body text-ink-2">{p.buildings.length ? 'Noch keine Pläne. Lade sie als Bild oder PDF hoch und markiere darauf, wo die Elemente sind.' : 'Lege zuerst ein Gebäude an.'}</p>
      </Section>
    );
  const placed = (bid: string) => p.assets.filter((a) => a.buildingId === bid && a.floorPlanId).length;
  return (
    <Section id="grundrisse" title="Grundrisse" aria-label="Grundrisse" count={p.floorPlans.length} action={upload}>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-5 pt-1 sm:grid-cols-3 lg:grid-cols-4">
        {p.floorPlans.map((f) => {
          const b = p.buildings.find((x) => x.id === f.buildingId);
          const total = p.assets.filter((a) => a.buildingId === f.buildingId).length;
          return (
            <li key={f.id} className="min-w-0">
              <Link to={`/grundrisse/${f.id}`} className="group block">
                <div className="relative overflow-hidden rounded-md bg-sunken" style={{ aspectRatio: '4 / 3' }}>
                  <img src={fileUrl(f.fileKey)} alt={f.name} className="absolute inset-0 size-full object-contain p-2 mix-blend-multiply" loading="lazy" />
                </div>
                <span className="mt-2 block truncate text-body text-ink group-hover:underline group-hover:decoration-line-strong group-hover:underline-offset-4">{f.name}</span>
                <span className="block truncate text-meta text-ink-3" title={`${placed(f.buildingId)} von ${total} Elementen des Gebäudes auf einem Plan`}>
                  {[p.buildings.length > 1 ? b?.name : null, `${f.markers} Marker`].filter(Boolean).join(' · ')}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** Dateien des Objekts: Objektbericht, Sammelmappe; abgelegte Berichte erst beim Aufklappen laden. */
function Files({ p, canInspect }: { p: PropertyDetail; canInspect: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <Section title="Dateien" aria-label="Dateien">
      <div className="flex flex-wrap gap-2">
        <PropertyReportButton propertyId={p.id} variant="secondary" />
        {canInspect && <MappeButton propertyId={p.id} variant="ghost" />}
      </div>
      <div className="mt-3 border-t border-line">
        <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} className="flex min-h-11 w-full items-center gap-2 text-left text-meta font-medium text-ink-2 hover:text-ink">
          <ChevronDown className={open ? 'size-4 rotate-180 transition-transform' : 'size-4 transition-transform'} />
          Abgelegte Dateien
        </button>
        {open && <Archive propertyId={p.id} />}
      </div>
    </Section>
  );
}

function Archive({ propertyId }: { propertyId: string }) {
  const reports = useReports();
  if (reports.isLoading) return <SkeletonList rows={2} className="shadow-none" />;
  if (reports.error) return <ErrorBox error={reports.error} onRetry={() => reports.refetch()} />;
  const mine = (reports.data ?? []).filter((r) => r.propertyId === propertyId);
  if (!mine.length) return <p className="pb-2 text-body text-ink-2">Noch nichts abgelegt. Objektbericht und Sammelmappe landen nach dem Erzeugen hier.</p>;
  return (
    <ul className="pk-list -mx-(--row-px)" aria-label="Abgelegte Dateien">
      {mine.map((r) => (
        <li key={r.id}>
          <a
            href={`/api/reports/${r.id}/file`}
            download={r.fileName}
            className="group flex min-h-[52px] items-center gap-3 px-(--row-px) py-2 transition-colors hover:bg-hover sm:min-h-11"
            aria-label={`${r.title} herunterladen`}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body text-ink">{r.title}</span>
              <span className="block truncate text-meta text-ink-3">
                {fmtDateTime(r.createdAt)}
                {r.createdBy ? ` · ${r.createdBy}` : ''} · {Math.max(1, Math.round(r.size / 1024))} KB
              </span>
            </span>
            <Download className="size-4 shrink-0 text-ink-3 group-hover:text-ink" />
          </a>
        </li>
      ))}
    </ul>
  );
}

function FireOfficers({ propertyId, officers, canEdit }: { propertyId: string; officers: FireOfficer[]; canEdit: boolean }) {
  const [edit, setEdit] = useState<Partial<FireOfficer> | null>(null);
  const now = Date.now();
  const current = officers.find((o) => o.appointedFrom <= now && (!o.appointedTo || o.appointedTo > now));
  const history = officers.filter((o) => o !== current);
  return (
    <Section
      title="Brandschutzbeauftragte/r"
      aria-label="Brandschutzbeauftragte/r"
      action={
        canEdit && (
          <Button size="sm" variant="ghost" onClick={() => setEdit({})}>
            Bestellen
          </Button>
        )
      }
    >
      {edit && <FireOfficerForm propertyId={propertyId} initial={edit} onClose={() => setEdit(null)} />}
      {current ? (
        <button type="button" className="group block w-full text-left disabled:cursor-default" disabled={!canEdit} onClick={() => setEdit(current)}>
          <span className="flex items-center gap-2 text-body text-ink group-enabled:group-hover:underline group-enabled:group-hover:decoration-line-strong group-enabled:group-hover:underline-offset-4">
            <StatusDot tone="ok" />
            {current.name}
          </span>
          <span className="mt-0.5 block text-meta text-ink-3">
            {[current.company, current.qualification, `seit ${fmtDate(current.appointedFrom)}`, current.appointedTo && `bis ${fmtDate(current.appointedTo)}`].filter(Boolean).join(' · ')}
          </span>
          {(current.phone || current.email) && <span className="block truncate text-meta text-ink-2">{[current.phone, current.email].filter(Boolean).join(' · ')}</span>}
        </button>
      ) : (
        <p className="text-body text-ink-2">Niemand bestellt.</p>
      )}
      {history.length > 0 && (
        <details className="mt-3 text-meta">
          <summary className="cursor-pointer text-ink-3 hover:text-ink-2">Frühere {history.length}</summary>
          <ul className="mt-2 space-y-1.5">
            {history.map((o) => (
              <li key={o.id}>
                <button type="button" className="text-left text-ink-2 hover:underline disabled:no-underline" disabled={!canEdit} onClick={() => setEdit(o)}>
                  {o.name}
                  {o.company && ` (${o.company})`} · {fmtDate(o.appointedFrom)} – {o.appointedTo ? fmtDate(o.appointedTo) : 'offen'}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </Section>
  );
}

const dateIn = (t: number | null | undefined) => (t ? new Date(t).toISOString().slice(0, 10) : '');
const dateOut = (s: string) => (s ? new Date(`${s}T12:00:00`).getTime() : null);

function FireOfficerForm({ propertyId, initial, onClose }: { propertyId: string; initial: Partial<FireOfficer>; onClose: () => void }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [f, setF] = useState({
    name: initial.name ?? '',
    company: initial.company ?? '',
    phone: initial.phone ?? '',
    email: initial.email ?? '',
    qualification: initial.qualification ?? '',
    from: dateIn(initial.appointedFrom ?? Date.now()),
    to: dateIn(initial.appointedTo),
    notes: initial.notes ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const body = () => ({ name: f.name, company: f.company, phone: f.phone, email: f.email, qualification: f.qualification, appointedFrom: dateOut(f.from), appointedTo: dateOut(f.to), notes: f.notes });
  const save = useAction(
    () => (initial.id ? api(`/fire-officers/${initial.id}`, { method: 'PATCH', body: body() }) : api(`/properties/${propertyId}/fire-officers`, { body: body() })),
    () => {
      toast('Gespeichert');
      onClose();
    },
  );
  const del = useAction(() => api(`/fire-officers/${initial.id}`, { method: 'DELETE' }), () => onClose());
  return (
    <Modal
      title={initial.id ? 'Brandschutzbeauftragte/n bearbeiten' : 'Brandschutzbeauftragte/n bestellen'}
      description={initial.id ? undefined : 'Eine laufende Bestellung endet automatisch zum Startdatum.'}
      onClose={onClose}
      footer={
        <>
          {initial.id && (
            <Button
              variant="ghost"
              className="sm:mr-auto"
              onClick={async () => (await confirm({ title: 'Eintrag löschen?', confirmLabel: 'Löschen', danger: true })) && del.mutate(undefined)}
            >
              Löschen
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button form="officer-form" loading={save.isPending}>
            Speichern
          </Button>
        </>
      }
    >
      {confirmEl}
      <form
        id="officer-form"
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
        <Field label="Name">{(id) => <Input id={id} required value={f.name} onChange={set('name')} />}</Field>
        <Field label="Firma / Stelle" optional>
          {(id) => <Input id={id} value={f.company} onChange={set('company')} />}
        </Field>
        <Field label="Telefon" optional>
          {(id) => <Input id={id} value={f.phone} onChange={set('phone')} />}
        </Field>
        <Field label="E-Mail" optional>
          {(id) => <Input id={id} type="email" value={f.email} onChange={set('email')} />}
        </Field>
        <Field label="Qualifikation" optional className="sm:col-span-2">
          {(id) => <Input id={id} value={f.qualification} onChange={set('qualification')} placeholder="z. B. Brandschutzbeauftragte/r nach DGUV 205-003" />}
        </Field>
        <Field label="Bestellt ab">{(id) => <Input id={id} type="date" required value={f.from} onChange={set('from')} />}</Field>
        <Field label="Bestellt bis" optional hint="Leer = unbefristet">
          {(id) => <Input id={id} type="date" value={f.to} onChange={set('to')} />}
        </Field>
        <Field label="Notizen" optional className="sm:col-span-2">
          {(id) => <Textarea id={id} value={f.notes} onChange={set('notes')} />}
        </Field>
      </form>
    </Modal>
  );
}



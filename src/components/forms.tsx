import { getCategory, allCategories } from '../categories';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Camera, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { type FormEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type Category } from '../../shared/catalog';
import { BUILDING_TYPES, type BuildingType } from '../../shared/walkthrough';
import { api, type Asset, type PropertyDetail, uploadPhoto, useAction, useProperties, useProperty } from '../api';
import { CategoryIcon } from './CategoryIcon';
import { lastFloor, readLastPlace, rememberPlace } from './objects/memory';
import { Button, ErrorBox, Field, Input, Modal, Notice, Select, Textarea, useToast } from './ui';

/** Abschnittstitel innerhalb eines Formulars (docs/design.md 5.3). */
function FormSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className={className}>
      <legend className="mb-3 text-meta font-semibold text-ink-2">{title}</legend>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

export function PropertyForm({ initial, onClose }: { initial?: PropertyDetail; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [f, setF] = useState({
    name: initial?.name ?? '',
    address: initial?.address ?? '',
    description: initial?.description ?? '',
    contactName: initial?.contactName ?? '',
    contactPhone: initial?.contactPhone ?? '',
    contactEmail: initial?.contactEmail ?? '',
    buildingType: initial?.buildingType ?? ('general' as BuildingType),
    pdfPattern: initial?.pdfPattern ?? '',
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = useAction(
    () => (initial ? api(`/properties/${initial.id}`, { method: 'PATCH', body: f }) : api<{ id: string }>('/properties', { body: f })),
    (r) => {
      toast(initial ? 'Objekt gespeichert' : 'Objekt angelegt');
      onClose();
      if (!initial && r && typeof r === 'object' && 'id' in r) navigate(`/objekte/${(r as { id: string }).id}`);
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined);
  };
  return (
    <Modal
      title={initial ? 'Objekt bearbeiten' : 'Neues Objekt'}
      description={initial ? undefined : 'Danach legst du Gebäude und Elemente an.'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button form="property-form" loading={save.isPending}>
            Speichern
          </Button>
        </>
      }
    >
      <form id="property-form" onSubmit={submit} className="flex flex-col gap-6">
        {save.error && <ErrorBox error={save.error} />}
        <div className="flex flex-col gap-4">
          <Field label="Name">{(id) => <Input id={id} required autoFocus value={f.name} onChange={set('name')} placeholder="z. B. Grundschule Am Park" />}</Field>
          <Field label="Adresse" optional>
            {(id) => <Textarea id={id} dictate={false} className="min-h-16" value={f.address} onChange={set('address')} placeholder={'Straße Nr.\nPLZ Ort'} />}
          </Field>
          <Field label="Nutzung" hint="Bestimmt die Fragen der Brandschutzbegehung.">
            {(id) => (
              <Select id={id} value={f.buildingType} onChange={(e) => setF({ ...f, buildingType: e.target.value as BuildingType })}>
                {Object.entries(BUILDING_TYPES).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <FormSection title="Vor Ort">
          <Field label="Ansprechperson" optional>
            {(id) => <Input id={id} value={f.contactName} onChange={set('contactName')} />}
          </Field>
          <Field label="Telefon" optional>
            {(id) => <Input id={id} type="tel" value={f.contactPhone} onChange={set('contactPhone')} />}
          </Field>
          <Field label="E-Mail" optional className="sm:col-span-2">
            {(id) => <Input id={id} type="email" value={f.contactEmail} onChange={set('contactEmail')} />}
          </Field>
          <Field label="Notizen" optional className="sm:col-span-2">
            {(id) => <Textarea id={id} value={f.description} onChange={set('description')} placeholder="Zugang, Schlüssel, Besonderheiten …" />}
          </Field>
        </FormSection>
        {initial && (
          <Field label="PDF-Dateinamen (nur dieses Objekt)" optional hint="Leer = Vorgabe des Unternehmens. Platzhalter: {datum} {code} {art} {pruefart} {objekt} {gebaeude} {standort} {ergebnis}">
            {(id) => <Input id={id} value={f.pdfPattern} onChange={set('pdfPattern')} className="font-mono" placeholder="{objekt}_{datum}_{code}" />}
          </Field>
        )}
      </form>
    </Modal>
  );
}

export function BuildingForm({ propertyId, initial, onClose }: { propertyId: string; initial?: { id: string; name: string; address: string }; onClose: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: initial?.name ?? '', address: initial?.address ?? '' });
  const save = useAction(
    () => (initial ? api(`/buildings/${initial.id}`, { method: 'PATCH', body: f }) : api(`/properties/${propertyId}/buildings`, { body: f })),
    () => {
      toast(initial ? 'Gebäude gespeichert' : 'Gebäude angelegt');
      onClose();
    },
  );
  return (
    <Modal
      title={initial ? 'Gebäude bearbeiten' : 'Neues Gebäude'}
      size="sm"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button form="building-form" loading={save.isPending}>
            Speichern
          </Button>
        </>
      }
    >
      <form
        id="building-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
        className="flex flex-col gap-4"
      >
        {save.error && <ErrorBox error={save.error} />}
        <Field label="Name">{(id) => <Input id={id} required autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="z. B. Haus A" />}</Field>
        <Field label="Adresse" optional hint="Nur, wenn sie von der Adresse des Objekts abweicht.">
          {(id) => <Textarea id={id} dictate={false} className="min-h-16" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />}
        </Field>
      </form>
    </Modal>
  );
}

/** Objekt → Gebäude. Startet mit dem vorgegebenen bzw. zuletzt benutzten Objekt, solange es noch existiert. */
export function BuildingPicker({ value, onChange, initialPropertyId }: { value: string; onChange: (v: string) => void; initialPropertyId?: string }) {
  const props = useProperties();
  const [propertyId, setPropertyId] = useState(() => initialPropertyId ?? readLastPlace().propertyId ?? '');
  const detail = useProperty(propertyId);
  // Gemerktes Objekt/Gebäude verwerfen, wenn es nicht mehr da ist (gelöscht oder kein Zugriff)
  useEffect(() => {
    if (propertyId && props.data && !props.data.some((p) => p.id === propertyId)) {
      setPropertyId('');
      onChange('');
    }
  }, [props.data, propertyId, onChange]);
  useEffect(() => {
    if (value && detail.data && !detail.data.buildings.some((b) => b.id === value)) onChange('');
  }, [detail.data, value, onChange]);
  return (
    <>
      <Field label="Objekt">
        {(id) => (
          <Select
            id={id}
            required
            value={propertyId}
            onChange={(e) => {
              setPropertyId(e.target.value);
              onChange('');
            }}
          >
            <option value="">Bitte wählen …</option>
            {props.data?.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Gebäude" hint={propertyId && detail.data?.buildings.length === 0 ? 'Dieses Objekt hat noch kein Gebäude.' : undefined}>
        {(id) => (
          <Select id={id} required disabled={!propertyId} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">Bitte wählen …</option>
            {(propertyId ? detail.data?.buildings : [])?.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </>
  );
}

interface PlateResult {
  manufacturer: string | null;
  model: string | null;
  year: number | null;
  serial: string | null;
  approval: string | null;
}

/** Typenschild fotografieren → Hersteller, Modell, Seriennummer ausfüllen (nur mit Workers AI). */
function TypePlateButton({ onRead }: { onRead: (r: PlateResult) => void }) {
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => api<{ vision: boolean }>('/ai/status'), staleTime: 600_000 });
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  if (!status.data?.vision) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg bg-sunken px-3 py-2.5 sm:col-span-2">
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          setMsg('');
          try {
            const key = await uploadPhoto(file);
            const r = await api<PlateResult>('/ai/typeplate', { body: { key } });
            onRead(r);
            setMsg([r.manufacturer, r.model, r.year && `Baujahr ${r.year}`, r.approval && `Zulassung ${r.approval}`].filter(Boolean).join(' · ') || 'Nichts lesbar');
          } catch (x) {
            setMsg(x instanceof Error ? x.message : 'Nicht lesbar');
          } finally {
            setBusy(false);
          }
        }}
      />
      <Button type="button" size="sm" variant="secondary" loading={busy} icon={<Camera className="size-4" />} onClick={() => ref.current?.click()}>
        Typenschild fotografieren
      </Button>
      <span className="min-w-0 flex-1 text-caption text-ink-3">{msg || 'Füllt Hersteller, Modell und Seriennummer aus.'}</span>
    </div>
  );
}

/** Ergebnis der Bilderkennung (POST /ai/identify). */
export interface IdentifyResult {
  category: string | null;
  manufacturer: string | null;
  model: string | null;
  year: number | null;
  serial: string | null;
  confidence: number;
}

/** Foto beim Anlegen: hochladen, Art und Typenschild erkennen lassen. Ohne KI (503) bleibt es beim Foto. */
export interface FirstPhoto {
  key: string;
  preview: string;
  result: IdentifyResult | null;
}

function PhotoFirst({ onDone, photo }: { onDone: (p: FirstPhoto) => void; photo: FirstPhoto | null }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <div className="flex flex-col gap-2">
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label="Foto des Elements"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          setErr('');
          try {
            const key = await uploadPhoto(file);
            // Erkennung ist optional: ohne KI oder bei Fehler still bei der manuellen Auswahl bleiben
            const result = await api<IdentifyResult>('/ai/identify', { body: { key } }).catch(() => null);
            onDone({ key, preview: URL.createObjectURL(file), result });
          } catch (x) {
            setErr(x instanceof Error ? x.message : 'Hochladen fehlgeschlagen');
          } finally {
            setBusy(false);
          }
        }}
      />
      <button
        type="button"
        disabled={busy}
        onClick={() => ref.current?.click()}
        className="flex min-h-16 w-full items-center gap-3 rounded-xl border border-line-strong bg-surface px-3 py-2.5 text-left transition-colors hover:bg-hover"
      >
        {photo ? (
          <img src={photo.preview} alt="Foto des Elements" className="size-11 shrink-0 rounded-lg object-cover" />
        ) : (
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-ink text-white">{busy ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block text-body font-semibold">{busy ? 'Wird erkannt …' : photo ? 'Anderes Foto aufnehmen' : 'Foto aufnehmen'}</span>
          <span className="block text-meta text-ink-3">
            {photo ? 'Foto übernommen – bitte die Art unten wählen.' : 'Art und Typenschild werden erkannt, du bestätigst nur noch.'}
          </span>
        </span>
      </button>
      {err && <p className="text-caption text-bad">{err}</p>}
    </div>
  );
}

/** Schritt 1 beim Anlegen: Foto aufnehmen oder Art wählen (Liste mit Norm und Intervall). */
function CategoryPicker({ onPick, onClose, photo, onPhoto }: { onPick: (c: Category) => void; onClose: () => void; photo: FirstPhoto | null; onPhoto: (p: FirstPhoto) => void }) {
  return (
    <Modal title="Neues Element" description="Foto aufnehmen oder Art wählen" onClose={onClose}>
      <PhotoFirst photo={photo} onDone={onPhoto} />
      <p className="mt-5 mb-1 text-meta font-medium text-ink-3">Art wählen</p>
      <ul className="-mx-2 flex flex-col">
        {allCategories().map((c) => (
          <li key={c.key}>
            <button type="button" onClick={() => onPick(c.key)} className="group flex min-h-14 w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-hover">
              <CategoryIcon category={c.key} />
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium">{c.label}</span>
                <span className="block truncate text-meta text-ink-3">{[c.norm, `alle ${c.intervalMonths} Monate`].filter(Boolean).join(' · ')}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5" />
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}

export function AssetForm({
  initial,
  buildings,
  propertyId,
  defaultBuildingId,
  defaultLabel,
  onClose,
}: {
  initial?: Asset;
  buildings?: { id: string; name: string }[];
  /** Objekt, zu dem `buildings` gehören (für das Gedächtnis „zuletzt hier angelegt“) */
  propertyId?: string;
  defaultBuildingId?: string;
  defaultLabel?: string;
  onClose: (createdId?: string) => void;
}) {
  const toast = useToast();
  const [category, setCategory] = useState<Category | null>(initial?.category ?? null);
  const [f, setF] = useState(() => {
    const last = readLastPlace();
    const buildingId =
      initial?.buildingId ??
      defaultBuildingId ??
      (buildings ? (buildings.find((b) => b.id === last.buildingId)?.id ?? buildings[0]?.id) : last.buildingId) ??
      '';
    return {
      buildingId,
      location: initial?.location ?? '',
      floor: initial?.floor ?? (buildingId ? lastFloor(buildingId) : ''),
      manufacturer: initial?.manufacturer ?? '',
      model: initial?.model ?? '',
      code: '',
      labelCode: initial?.labelCode ?? defaultLabel ?? '',
    };
  });
  const [warnDays, setWarnDays] = useState<number | ''>(initial?.warnDays ?? '');
  const [attrs, setAttrs] = useState<Record<string, string | number | boolean | null>>(initial?.attributes ?? {});
  const [created, setCreated] = useState<string[]>([]);
  const [round, setRound] = useState(0);
  /** Foto zuerst: wird nach dem Anlegen am Element gespeichert */
  const [photo, setPhoto] = useState<FirstPhoto | null>(null);
  const prefill = (p: FirstPhoto, cat: Category | null) => {
    const r = p.result;
    if (!r) return;
    setF((x) => ({ ...x, manufacturer: r.manufacturer ?? x.manufacturer, model: [r.model, r.serial && `SN ${r.serial}`].filter(Boolean).join(' · ') || x.model }));
    if (cat && r.year && getCategory(cat).attributes.some((a) => a.key === 'year')) setAttrs((a) => ({ ...a, year: r.year }));
  };
  const onPhoto = (p: FirstPhoto) => {
    setPhoto(p);
    const cat = p.result?.category && p.result.confidence >= 0.5 && allCategories().some((c) => c.key === p.result!.category) ? (p.result.category as Category) : null;
    prefill(p, cat);
    if (cat) setCategory(cat);
  };
  const pick = (cat: Category) => {
    if (photo) prefill(photo, cat);
    setCategory(cat);
  };
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const setBuilding = (buildingId: string) => setF((x) => ({ ...x, buildingId, floor: (buildingId && lastFloor(buildingId)) || x.floor }));
  const save = useAction(
    (_again: boolean) =>
      initial
        ? api(`/assets/${initial.id}`, { method: 'PATCH', body: { ...f, labelCode: f.labelCode || undefined, attributes: attrs, warnDays: warnDays === '' ? null : warnDays } })
        : api<{ id: string; code: string }>('/assets', { body: { ...f, code: f.code || undefined, labelCode: f.labelCode || undefined, category, attributes: attrs, warnDays: warnDays === '' ? null : warnDays } }),
    (r, again) => {
      const made = !initial && r && typeof r === 'object' ? (r as { id: string; code: string }) : undefined;
      if (made) rememberPlace({ propertyId: initial ? undefined : propertyId, buildingId: f.buildingId, floor: f.floor });
      if (made && photo) {
        // Foto vom Anlegen als Anhang am Element ablegen (Fehler hier verhindern das Anlegen nicht)
        void api(`/assets/${made.id}/attachments`, { body: { key: photo.key, name: 'Foto beim Anlegen', contentType: 'image/jpeg', size: 0, caption: 'Foto beim Anlegen' } }).catch(() => undefined);
        setPhoto(null);
      }
      toast(made ? `${made.code} angelegt` : 'Element gespeichert');
      if (made && again) {
        // gleiche Art, gleiches Gebäude, gleiche Etage – nur Standort und Kennungen leeren
        setCreated((c) => [...c, made.code]);
        setF((x) => ({ ...x, location: '', code: '', labelCode: '' }));
        setRound((n) => n + 1);
        return;
      }
      onClose(made?.id);
    },
  );

  if (!category) return <CategoryPicker onPick={pick} onClose={() => onClose()} photo={photo} onPhoto={onPhoto} />;

  const def = getCategory(category);
  const buildingName = buildings?.find((b) => b.id === f.buildingId)?.name;
  return (
    <Modal
      wide
      title={
        <span className="flex items-center gap-3">
          <CategoryIcon category={category} size="sm" />
          {initial ? `${initial.code} bearbeiten` : `${def.label} anlegen`}
        </span>
      }
      description={
        created.length ? `Schon angelegt: ${created.join(', ')}` : initial ? undefined : [def.norm, `alle ${def.intervalMonths} Monate`].filter(Boolean).join(' · ')
      }
      onClose={() => onClose()}
      footer={
        initial ? (
          <>
            <Button variant="secondary" onClick={() => onClose()}>
              Abbrechen
            </Button>
            <Button form="asset-form" loading={save.isPending}>
              Speichern
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setCategory(null)} className="max-sm:!flex-none sm:mr-auto" icon={<ArrowLeft className="size-4" />} aria-label="Zurück zur Auswahl der Art">
              <span className="max-sm:hidden">Zurück</span>
            </Button>
            <Button id="asset-again" form="asset-form" variant="secondary" disabled={save.isPending}>
              Speichern & neu
            </Button>
            <Button form="asset-form" loading={save.isPending}>
              Speichern
            </Button>
          </>
        )
      }
    >
      <form
        id="asset-form"
        onSubmit={(e) => {
          e.preventDefault();
          const submitter = (e.nativeEvent as SubmitEvent).submitter;
          save.mutate(submitter?.id === 'asset-again');
        }}
        className="flex flex-col gap-6"
      >
        {save.error && <ErrorBox error={save.error} />}
        {photo && !initial && (
          <Notice
            tone="info"
            icon={<Sparkles />}
            title={photo.result?.category === category ? `Erkannt: ${def.label}` : 'Foto übernommen'}
            action={<img src={photo.preview} alt="Foto des Elements" className="size-12 rounded-lg object-cover" />}
          >
            {photo.result?.category === category
              ? 'Art und Angaben vom Foto vorgeschlagen – bitte prüfen. Falsche Art? Zurück zur Auswahl.'
              : 'Das Foto wird mit dem Element gespeichert.'}
          </Notice>
        )}
        <FormSection title="Ort">
          {buildings ? (
            <Field label="Gebäude" className="sm:col-span-2">
              {(id) => (
                <Select id={id} required value={f.buildingId} onChange={(e) => setBuilding(e.target.value)}>
                  {buildings.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <BuildingPicker value={f.buildingId} onChange={setBuilding} />
          )}
          <Field label="Standort" hint="z. B. Treppenhaus Nord, Raum 1.04">
            {(id) => <Input key={round} id={id} autoFocus={round > 0} value={f.location} onChange={set('location')} />}
          </Field>
          <Field label="Etage" optional hint={!initial && f.floor && buildingName ? `Zuletzt in ${buildingName} benutzt` : undefined}>
            {(id) => <Input id={id} value={f.floor} onChange={set('floor')} placeholder="EG, 1. OG …" />}
          </Field>
        </FormSection>
        <FormSection title="Gerät">
          <TypePlateButton
            onRead={(r) =>
              setF((x) => ({ ...x, manufacturer: r.manufacturer ?? x.manufacturer, model: [r.model, r.serial && `SN ${r.serial}`].filter(Boolean).join(' · ') || x.model }))
            }
          />
          <Field label="Hersteller" optional>
            {(id) => <Input id={id} value={f.manufacturer} onChange={set('manufacturer')} />}
          </Field>
          <Field label="Typ / Modell" optional>
            {(id) => <Input id={id} value={f.model} onChange={set('model')} />}
          </Field>
        </FormSection>
        {def.attributes.length > 0 && (
          <FormSection title="Stammdaten">
            {def.attributes.map((a) => {
              const v = attrs[a.key];
              if (a.type === 'boolean')
                return (
                  <label key={a.key} className="flex min-h-10 items-center gap-3 self-end text-body">
                    <input type="checkbox" className="size-4 accent-ink" checked={!!v} onChange={(e) => setAttrs({ ...attrs, [a.key]: e.target.checked })} />
                    {a.label}
                  </label>
                );
              return (
                <Field key={a.key} label={a.label}>
                  {(id) =>
                    a.type === 'select' ? (
                      <Select id={id} value={(v as string) ?? ''} onChange={(e) => setAttrs({ ...attrs, [a.key]: e.target.value || null })}>
                        <option value="">–</option>
                        {a.options!.map((o) => (
                          <option key={o}>{o}</option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        id={id}
                        type={a.type === 'number' ? 'number' : a.type === 'date' ? 'date' : 'text'}
                        value={(v as string | number) ?? ''}
                        onChange={(e) => setAttrs({ ...attrs, [a.key]: a.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value })}
                      />
                    )
                  }
                </Field>
              );
            })}
          </FormSection>
        )}
        <FormSection title="Kennung und Erinnerung">
          {!initial && (
            <Field label="Code" optional hint={`Leer lassen für ${def.prefix}-0001 usw.`}>
              {(id) => <Input id={id} value={f.code} onChange={set('code')} placeholder={`${def.prefix}-…`} className="uppercase" />}
            </Field>
          )}
          <Field label="QR-Etikett" optional hint="Code eines vorgedruckten Etiketts" className={initial ? 'sm:col-span-2' : undefined}>
            {(id) => <Input id={id} value={f.labelCode} onChange={set('labelCode')} placeholder="z. B. PK-7Q2M9X" className="uppercase" />}
          </Field>
          <Field label="Vorwarnung (Tage vor Fälligkeit)" optional hint="Leer = Vorgabe des Workspaces" className="sm:col-span-2">
            {(id) => (
              <Input
                id={id}
                type="number"
                min={1}
                max={365}
                inputMode="numeric"
                className="sm:max-w-40"
                value={warnDays}
                onChange={(e) => setWarnDays(e.target.value === '' ? '' : Math.max(1, Math.min(365, Math.round(Number(e.target.value)))))}
              />
            )}
          </Field>
        </FormSection>
      </form>
    </Modal>
  );
}

export function attributeRows(category: Category, attrs: Record<string, unknown>): [string, string][] {
  return getCategory(category).attributes.map((a) => {
    const v = attrs[a.key];
    return [a.label, v === true ? 'Ja' : v === false ? 'Nein' : v == null || v === '' ? '–' : String(v)];
  });
}

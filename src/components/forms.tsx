import { getCategory, allCategories } from '../categories';
import { useQuery } from '@tanstack/react-query';
import { Camera } from 'lucide-react';
import { type FormEvent, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { type Category } from '../../shared/catalog';
import { BUILDING_TYPES, type BuildingType } from '../../shared/walkthrough';
import { api, type Asset, type PropertyDetail, uploadPhoto, useAction, useProperties, useProperty } from '../api';
import { CategoryIcon } from './CategoryIcon';
import { Button, ErrorBox, Field, Input, Modal, Select, Textarea, useToast } from './ui';

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
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button form="property-form" loading={save.isPending}>
            Speichern
          </Button>
        </>
      }
    >
      <form id="property-form" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {save.error && <ErrorBox error={save.error} />}
        <Field label="Name" className="sm:col-span-2">
          {(id) => <Input id={id} required autoFocus value={f.name} onChange={set('name')} placeholder="z. B. Grundschule Am Park" />}
        </Field>
        <Field label="Adresse" className="sm:col-span-2">
          {(id) => <Textarea id={id} className="min-h-16" value={f.address} onChange={set('address')} placeholder={'Straße Nr.\nPLZ Ort'} />}
        </Field>
        <Field label="Nutzung" hint="Steuert die Fragen der Brandschutzbegehung" className="sm:col-span-2">
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
        <Field label="Ansprechperson">{(id) => <Input id={id} value={f.contactName} onChange={set('contactName')} />}</Field>
        <Field label="Telefon">{(id) => <Input id={id} type="tel" value={f.contactPhone} onChange={set('contactPhone')} />}</Field>
        <Field label="E-Mail" className="sm:col-span-2">
          {(id) => <Input id={id} type="email" value={f.contactEmail} onChange={set('contactEmail')} />}
        </Field>
        <Field label="Notizen" className="sm:col-span-2">
          {(id) => <Textarea id={id} value={f.description} onChange={set('description')} placeholder="Zugang, Schlüssel, Besonderheiten …" />}
        </Field>
        {initial && (
          <Field label="PDF-Dateinamen (nur dieses Objekt)" hint="Leer = Vorgabe des Unternehmens. Platzhalter: {datum} {code} {art} {pruefart} {objekt} {gebaeude} {standort} {ergebnis}" className="sm:col-span-2">
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
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
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
        <Field label="Adresse" hint="Optional, falls abweichend vom Objekt">
          {(id) => <Textarea id={id} className="min-h-16" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />}
        </Field>
      </form>
    </Modal>
  );
}

function BuildingPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const props = useProperties();
  const [propertyId, setPropertyId] = useState('');
  const detail = useProperty(propertyId);
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
    <div className="flex flex-wrap items-center gap-3 rounded-xl bg-brand-soft p-3 sm:col-span-2">
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
      <span className="min-w-0 flex-1 text-xs text-brand-strong">{msg || 'Füllt Hersteller, Modell und Seriennummer automatisch aus.'}</span>
    </div>
  );
}

export function AssetForm({
  initial,
  buildings,
  defaultBuildingId,
  defaultLabel,
  onClose,
}: {
  initial?: Asset;
  buildings?: { id: string; name: string }[];
  defaultBuildingId?: string;
  defaultLabel?: string;
  onClose: (createdId?: string) => void;
}) {
  const toast = useToast();
  const [category, setCategory] = useState<Category | null>(initial?.category ?? null);
  const [f, setF] = useState({
    buildingId: initial?.buildingId ?? defaultBuildingId ?? buildings?.[0]?.id ?? '',
    location: initial?.location ?? '',
    floor: initial?.floor ?? '',
    manufacturer: initial?.manufacturer ?? '',
    model: initial?.model ?? '',
    code: '',
    labelCode: initial?.labelCode ?? defaultLabel ?? '',
  });
  const [warnDays, setWarnDays] = useState<number | ''>(initial?.warnDays ?? '');
  const [attrs, setAttrs] = useState<Record<string, string | number | boolean | null>>(initial?.attributes ?? {});
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const save = useAction(
    () =>
      initial
        ? api(`/assets/${initial.id}`, { method: 'PATCH', body: { ...f, labelCode: f.labelCode || undefined, attributes: attrs, warnDays: warnDays === '' ? null : warnDays } })
        : api<{ id: string; code: string }>('/assets', { body: { ...f, code: f.code || undefined, labelCode: f.labelCode || undefined, category, attributes: attrs, warnDays: warnDays === '' ? null : warnDays } }),
    (r) => {
      const created = !initial && r && typeof r === 'object' ? (r as { id: string; code: string }) : undefined;
      toast(created ? `${created.code} angelegt` : 'Element gespeichert');
      onClose(created?.id);
    },
  );

  if (!category) {
    return (
      <Modal title="Neues Element" onClose={() => onClose()}>
        <p className="mb-4 text-sm text-ink-3">Welche Art von Element möchtest du anlegen?</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {allCategories().map((c) => (
            <button
              key={c.key}
              onClick={() => setCategory(c.key)}
              className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4 text-left shadow-card transition hover:border-ink-3"
            >
              <CategoryIcon category={c.key} />
              <span>
                <span className="block text-sm font-semibold">{c.label}</span>
                <span className="block text-xs text-ink-3">
                  {c.norm} · alle {c.intervalMonths} Monate
                </span>
              </span>
            </button>
          ))}
        </div>
      </Modal>
    );
  }

  const def = getCategory(category);
  return (
    <Modal
      wide
      title={
        <span className="flex items-center gap-3">
          <CategoryIcon category={category} size="sm" />
          {initial ? `${initial.code} bearbeiten` : `Neue ${def.label}`}
        </span>
      }
      onClose={() => onClose()}
      footer={
        <>
          {!initial && (
            <Button variant="ghost" onClick={() => setCategory(null)} className="mr-auto">
              Zurück
            </Button>
          )}
          <Button variant="ghost" onClick={() => onClose()}>
            Abbrechen
          </Button>
          <Button form="asset-form" loading={save.isPending}>
            Speichern
          </Button>
        </>
      }
    >
      <form
        id="asset-form"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
        className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      >
        {save.error && (
          <div className="sm:col-span-2">
            <ErrorBox error={save.error} />
          </div>
        )}
        {buildings ? (
          <Field label="Gebäude" className="sm:col-span-2">
            {(id) => (
              <Select id={id} required value={f.buildingId} onChange={(e) => setF({ ...f, buildingId: e.target.value })}>
                {buildings.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <BuildingPicker value={f.buildingId} onChange={(v) => setF({ ...f, buildingId: v })} />
        )}
        <Field label="Standort" hint="z. B. Treppenhaus Nord, Raum 1.04">
          {(id) => <Input id={id} value={f.location} onChange={set('location')} />}
        </Field>
        <Field label="Etage">{(id) => <Input id={id} value={f.floor} onChange={set('floor')} placeholder="EG, 1. OG …" />}</Field>
        <TypePlateButton
          onRead={(r) =>
            setF((x) => ({ ...x, manufacturer: r.manufacturer ?? x.manufacturer, model: [r.model, r.serial && `SN ${r.serial}`].filter(Boolean).join(' · ') || x.model }))
          }
        />
        <Field label="Hersteller">{(id) => <Input id={id} value={f.manufacturer} onChange={set('manufacturer')} />}</Field>
        <Field label="Typ / Modell">{(id) => <Input id={id} value={f.model} onChange={set('model')} />}</Field>
        <Field label="Vorwarnung (Tage vor Fälligkeit)" hint="Leer = Vorgabe des Workspaces">
          {(id) => (
            <Input
              id={id}
              type="number"
              min={1}
              max={365}
              inputMode="numeric"
              value={warnDays}
              onChange={(e) => setWarnDays(e.target.value === '' ? '' : Math.max(1, Math.min(365, Math.round(Number(e.target.value)))))}
            />
          )}
        </Field>
        {!initial && (
          <Field label="Code" hint={`Leer lassen für automatischen Code (${def.prefix}-XXXX)`} className="sm:col-span-2">
            {(id) => <Input id={id} value={f.code} onChange={set('code')} placeholder={`${def.prefix}-…`} className="uppercase" />}
          </Field>
        )}
        <Field label="QR-Etikett" hint="Optional: Code eines vorgedruckten Etiketts" className={initial ? 'sm:col-span-2' : 'sm:col-span-2'}>
          {(id) => <Input id={id} value={f.labelCode} onChange={set('labelCode')} placeholder="z. B. PK-7Q2M9X" className="uppercase" />}
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-3 border-t border-line pt-4 text-[13px] font-semibold text-ink-2">Stammdaten</p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {def.attributes.map((a) => {
              const v = attrs[a.key];
              if (a.type === 'boolean')
                return (
                  <label key={a.key} className="flex h-10 items-center gap-3 self-end text-sm">
                    <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={!!v} onChange={(e) => setAttrs({ ...attrs, [a.key]: e.target.checked })} />
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
          </div>
        </div>
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

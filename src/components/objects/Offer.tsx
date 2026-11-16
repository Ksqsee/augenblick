// Angebot am Objekt (Plan v7, Paket X): Angebotsliste aus den offenen Mängeln – Position, Menge, Türnummern, Einzel- und
// Gesamtpreis. Gerechnet wird auf dem Server (GET /properties/:id/offer, Paket V); hier kommen Regie-/Anfahrtspositionen
// aus dem Katalog dazu (nur auf diesem Gerät gemerkt), dazu der Hinweis auf nicht zugeordnete Mängel und Serien-Vorschläge.
// Export als Excel und PDF. Kein Versand, keine Rechnung.
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, FileDown, FileSpreadsheet, Lightbulb, Plus, Trash2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { type ExtraLine, money, normalizeOffer, type Offer, offerRows, qty, seriesSuggestions } from '../../../shared/offer';
import { api, type PropertyDetail, useCatalog, useMe } from '../../api';
import { Button, Empty, ErrorBox, Field, IconButton, Input, Notice, Section, Select, SkeletonList, useToast } from '../ui';

/** Leistung aus dem Katalog (Paket V); defensiv gelesen, solange sich die Form noch setzt. */
export interface ServiceOption {
  key: string;
  title: string;
  unit: string;
  price: number;
  kind: string;
}

export function servicesOf(catalog: unknown): ServiceOption[] {
  const list = (catalog as { services?: unknown })?.services;
  if (!Array.isArray(list)) return [];
  return list
    .map((raw) => {
      const s = (raw ?? {}) as Record<string, unknown>;
      return {
        key: String(s.key ?? s.code ?? s.short ?? ''),
        title: String(s.title ?? s.label ?? s.name ?? ''),
        unit: String(s.unit ?? 'Stk'),
        price: Number(s.price ?? s.unitPrice ?? s.priceNet ?? 0) || 0,
        kind: String(s.kind ?? s.type ?? ''),
      };
    })
    .filter((s) => s.title);
}
const isRegie = (s: ServiceOption) => /regie|travel|anfahrt|extra/i.test(s.kind);

const storeKey = (pid: string) => `pk-offer-extra:${pid}`;
function loadExtras(pid: string): ExtraLine[] {
  try {
    const v = JSON.parse(localStorage.getItem(storeKey(pid)) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function saveExtras(pid: string, list: ExtraLine[]) {
  try {
    if (list.length) localStorage.setItem(storeKey(pid), JSON.stringify(list));
    else localStorage.removeItem(storeKey(pid));
  } catch {
    /* privater Modus: nur für diese Sitzung */
  }
}

export const useOffer = (propertyId: string, enabled = true) =>
  useQuery({ queryKey: ['offer', propertyId], queryFn: async () => normalizeOffer(await api<Offer>(`/properties/${propertyId}/offer`)), enabled });

const n2 = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const MAX_DOORS = 8;

export function OfferSection({ p }: { p: PropertyDetail }) {
  const { data: me } = useMe();
  const toast = useToast();
  const offer = useOffer(p.id);
  const catalog = useCatalog();
  const services = useMemo(() => servicesOf(catalog.data), [catalog.data]);
  const [extras, setExtras] = useState<ExtraLine[]>(() => loadExtras(p.id));
  useEffect(() => saveExtras(p.id, extras), [p.id, extras]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<'pdf' | 'xlsx' | null>(null);
  const suggestions = useMemo(() => (offer.data ? seriesSuggestions(offer.data, p.assets) : []), [offer.data, p.assets]);

  if (offer.isLoading) return <Section><SkeletonList rows={4} className="shadow-none" /></Section>;
  if (offer.error || !offer.data)
    return (
      <Section>
        <ErrorBox error={offer.error ?? new Error('Angebotsliste nicht verfügbar')} onRetry={() => offer.refetch()} />
      </Section>
    );
  const o = offer.data;
  const { rows, net } = offerRows(o, extras);
  const exportAs = async (what: 'pdf' | 'xlsx') => {
    if (!me) return;
    setBusy(what);
    try {
      const r = await import('../../pdf/nacharbeit');
      const { download, loadBrand } = await import('../../pdf/reports');
      const data = { offer: o, extras, property: { name: p.name, address: p.address }, suggestions };
      const brand = await loadBrand(me);
      if (what === 'pdf') download(await r.offerPdf(data, brand), r.offerFileName(p.name, 'pdf'));
      else download(r.offerXlsx(data, brand.lang ?? 'de'), r.offerFileName(p.name, 'xlsx'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export fehlgeschlagen', 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Section
        title="Angebot"
        count={rows.length}
        flush
        action={
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" icon={<FileSpreadsheet />} loading={busy === 'xlsx'} disabled={!rows.length && !o.unmapped.length} onClick={() => void exportAs('xlsx')}>
              Excel
            </Button>
            <Button size="sm" variant="ghost" icon={<FileDown />} loading={busy === 'pdf'} disabled={!rows.length && !o.unmapped.length} onClick={() => void exportAs('pdf')}>
              PDF
            </Button>
          </div>
        }
      >
        <p className="-mt-1 mb-3 px-(--row-px) text-meta text-ink-2">Aus den offenen Mängeln: Leistung, Menge und betroffene Elemente. Eine Liste zum Weiterverarbeiten – kein Versand, keine Rechnung.</p>
        {o.unmapped.length > 0 && (
          <div className="px-(--row-px) pb-3">
            <Notice tone="warn" icon={<AlertTriangle />} title={`${n2(o.unmapped.length, 'Mangel', 'Mängel')} ohne Leistung`}>
              <span data-offer-unmapped>Diese Mängel haben im Katalog keine Leistung und fehlen in der Summe. Bitte von Hand bepreisen oder im Katalog eine Leistung zuordnen.</span>
              <ul className="mt-2 flex flex-col gap-0.5">
                {o.unmapped.slice(0, 12).map((u) => (
                  <li key={u.defectId} className="min-w-0 break-words">
                    <Link to={`/offen?art=maengel&mangel=${encodeURIComponent(u.defectId)}`} className="underline decoration-ink-4 underline-offset-4 hover:text-ink">
                      {u.door ? `${u.door}: ` : ''}
                      {u.title}
                    </Link>
                  </li>
                ))}
                {o.unmapped.length > 12 && <li className="text-ink-3">… und {o.unmapped.length - 12} weitere</li>}
              </ul>
            </Notice>
          </div>
        )}
        {suggestions.length > 0 && (
          <div className="px-(--row-px) pb-3">
            <Notice tone="info" icon={<Lightbulb />} title="Vorschlag: Sammelposition">
              <ul className="flex flex-col gap-1" data-offer-series>
                {suggestions.map((s) => (
                  <li key={s.serviceKey + s.title}>{s.text}</li>
                ))}
              </ul>
            </Notice>
          </div>
        )}
        {!rows.length ? (
          <div className="px-(--row-px) pb-4">
            <Empty compact title="Keine Positionen" text={o.unmapped.length ? 'Alle offenen Mängel sind noch ohne Leistung.' : 'Keine offenen Mängel mit Leistung in diesem Objekt.'} />
          </div>
        ) : (
          <ul className="pk-list" aria-label="Positionen">
            {rows.map((r, i) => {
              const extra = r.extra ? extras[i - o.lines.length] : null;
              return (
                <li key={`${r.pos}-${r.serviceKey}`} data-offer-line={r.serviceKey || r.title} className="flex flex-col gap-1.5 px-(--row-px) py-3 sm:flex-row sm:items-start sm:gap-4">
                  <span className="hidden w-6 shrink-0 text-meta text-ink-3 tabular-nums sm:block">{r.pos}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-body break-words text-ink">
                      {r.title}
                      {r.serviceKey && <span className="ml-2 text-meta text-ink-3">{r.serviceKey}</span>}
                    </p>
                    {r.doors.length > 0 ? (
                      <p className="mt-0.5 text-meta break-words text-ink-3" title={r.doors.join(', ')}>
                        {r.doors.slice(0, MAX_DOORS).join(', ')}
                        {r.doors.length > MAX_DOORS && ` … +${r.doors.length - MAX_DOORS}`}
                      </p>
                    ) : (
                      r.extra && <p className="mt-0.5 text-meta text-ink-3">hinzugefügt · nur auf diesem Gerät</p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-3 sm:justify-end">
                    {extra ? (
                      <Input
                        aria-label={`Menge ${r.title}`}
                        type="number"
                        min={0}
                        step="any"
                        inputMode="decimal"
                        className="!w-20 text-right"
                        value={extra.quantity}
                        onChange={(e) => setExtras(extras.map((x) => (x.id === extra.id ? { ...x, quantity: Math.max(0, Number(e.target.value) || 0) } : x)))}
                      />
                    ) : (
                      <span className="text-meta text-ink-2 tabular-nums">{qty(r.quantity)}</span>
                    )}
                    <span className="text-meta text-ink-3 tabular-nums">
                      {r.unit} × {money(r.unitPrice)}
                    </span>
                    <span className="ml-auto min-w-24 text-right text-body text-ink tabular-nums sm:ml-0">{money(r.total)}</span>
                    {extra && <IconButton size="sm" label={`${r.title} entfernen`} icon={<Trash2 />} onClick={() => setExtras(extras.filter((x) => x.id !== extra.id))} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-3 border-t border-line px-(--row-px) py-3">
          {adding ? null : (
            <Button size="sm" variant="secondary" icon={<Plus />} onClick={() => setAdding(true)}>
              Regie / Anfahrt hinzufügen
            </Button>
          )}
          <p className="ml-auto text-body text-ink" data-offer-net>
            <span className="text-ink-3">Summe netto</span> <span className="font-semibold tabular-nums">{money(net)}</span>
          </p>
        </div>
        {adding && (
          <div className="border-t border-line px-(--row-px) py-3">
            <AddExtra
              services={services}
              onCancel={() => setAdding(false)}
              onAdd={(x) => {
                setExtras([...extras, x]);
                setAdding(false);
              }}
            />
          </div>
        )}
      </Section>
    </>
  );
}

/** Position hinzufügen: aus dem Katalog (Regie/Anfahrt zuerst) oder frei. */
function AddExtra({ services, onAdd, onCancel }: { services: ServiceOption[]; onAdd: (x: ExtraLine) => void; onCancel: () => void }) {
  const regie = services.filter(isRegie);
  const choices = regie.length ? regie : services;
  const [key, setKey] = useState(choices[0]?.key ?? '');
  const [own, setOwn] = useState(!choices.length);
  const [title, setTitle] = useState('');
  const [unit, setUnit] = useState('Stk');
  const [price, setPrice] = useState('');
  const [amount, setAmount] = useState('1');
  const picked = choices.find((s) => s.key === key);
  const num = (v: string) => Number(v.replace(',', '.')) || 0;
  const add = () => {
    const id = Math.random().toString(36).slice(2, 10);
    if (!own && picked) onAdd({ id, serviceKey: picked.key, title: picked.title, unit: picked.unit, unitPrice: picked.price, quantity: num(amount) || 1 });
    else if (title.trim()) onAdd({ id, serviceKey: '', title: title.trim(), unit: unit.trim() || 'Stk', unitPrice: num(price), quantity: num(amount) || 1 });
  };
  return (
    <form
      className="flex flex-col gap-3"
      aria-label="Position hinzufügen"
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      {choices.length > 0 && !own ? (
        <Field label={regie.length ? 'Regie- oder Anfahrtsposition' : 'Leistung aus dem Katalog'}>
          {(id) => (
            <Select id={id} value={key} onChange={(e) => setKey(e.target.value)}>
              {choices.map((s) => (
                <option key={s.key + s.title} value={s.key}>
                  {s.key ? `${s.key} · ` : ''}
                  {s.title} · {money(s.price)}/{s.unit}
                </option>
              ))}
            </Select>
          )}
        </Field>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-[minmax(0,1fr)_6rem_8rem]">
          <Field label="Bezeichnung" className="col-span-2 sm:col-span-1">
            {(id) => <Input id={id} required value={title} maxLength={200} placeholder="z. B. An- und Abfahrt" onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Field label="Einheit">{(id) => <Input id={id} value={unit} maxLength={20} onChange={(e) => setUnit(e.target.value)} />}</Field>
          <Field label="Preis netto">{(id) => <Input id={id} inputMode="decimal" value={price} placeholder="0,00" onChange={(e) => setPrice(e.target.value)} />}</Field>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Menge" className="w-28">
          {(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
        </Field>
        {choices.length > 0 && (
          <Button type="button" variant="ghost" size="sm" className="mb-1" onClick={() => setOwn(!own)}>
            {own ? 'Aus dem Katalog' : 'Eigene Position'}
          </Button>
        )}
        <div className="ml-auto flex gap-2">
          <Button type="button" variant="ghost" onClick={onCancel}>
            Abbrechen
          </Button>
          <Button icon={<Plus />}>Hinzufügen</Button>
        </div>
      </div>
    </form>
  );
}

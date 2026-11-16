// „Tür ansagen“ (Plan v7, Paket W) – Hauptweg auf „Prüfen“: „Tür 354, Typ SK32“ einsprechen oder tippen. Die Tür wird
// im gewählten Objekt gefunden (Nummer) oder angelegt (feste Nummer, Standort „Raum 354“, Stammdaten aus dem
// Katalog-Typ), dann öffnet die Prüfung. „Tür 355, gleicher Typ“ übernimmt den letzten Typ. Unbekannter Typ: Tür mit
// Typ „unbekannt“, allgemeine Checkliste, die Ansage bleibt als Rohnotiz. Ohne Netz mit den geladenen Gebäuden und dem
// gemerkten Katalog; neue Türen gehen mit der Warteschlange an den Server.
import { useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowRight, Printer } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  announcedAssetBody,
  findAnnounced,
  parseAnnouncement,
  productLabel,
  rawNote,
  resolveAnnouncedType,
} from '../../../shared/announce';
import type { CatalogProduct } from '../../../shared/catalog';
import { api, ApiError, type Asset, type PropertyDetail, useCatalog, useProperties } from '../../api';
import { getCategory } from '../../categories';
import { type Bundle, cachedProducts, cacheProducts, createLocalAsset, listBundles, useOfflineVersion, useOnline } from '../../offline';
import { Button, DictateInput, Section, Select, StatusText } from '../ui';
import { ToggleChip } from './Choice';

const MEM = 'pk:ansage';
interface Memory {
  propertyId?: string;
  buildingId?: string;
  /** zuletzt angesagter Typ – für „gleicher Typ“ */
  last?: { productId?: string; label?: string; unknown?: boolean };
}
function readMem(): Memory {
  try {
    const v = JSON.parse(localStorage.getItem(MEM) ?? '{}');
    return v && typeof v === 'object' ? (v as Memory) : {};
  } catch {
    return {};
  }
}
function writeMem(m: Memory) {
  try {
    localStorage.setItem(MEM, JSON.stringify(m));
  } catch {
    /* ohne Speicher */
  }
}

function useBundlesList() {
  const v = useOfflineVersion();
  const [list, setList] = useState<Bundle[]>([]);
  useEffect(() => {
    listBundles().then(setList);
  }, [v]);
  return list;
}

const labelOf = (key: string) => getCategory(key).label;

export function AnnounceCard({ autoFocus }: { autoFocus?: boolean }) {
  const online = useOnline();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [mem, setMem] = useState<Memory>(readMem);
  const remember = (patch: Memory) => {
    const m = { ...mem, ...patch };
    setMem(m);
    writeMem(m);
  };
  const props = useProperties();
  const bundles = useBundlesList();
  const catalog = useCatalog(online);
  const [stored, setStored] = useState<CatalogProduct[]>([]);
  useEffect(() => {
    if (catalog.data) void cacheProducts(catalog.data.products);
    else cachedProducts().then(setStored);
  }, [catalog.data]);

  // Objekte: online alle, ohne Netz die mit geladenen Gebäuden
  const offlineProps = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bundles) m.set(b.building.propertyId, b.building.propertyName);
    return [...m].map(([id, name]) => ({ id, name }));
  }, [bundles]);
  const propertyOptions = online && props.data ? props.data.map((p) => ({ id: p.id, name: p.name })) : offlineProps;
  const propertyId = propertyOptions.some((p) => p.id === mem.propertyId) ? mem.propertyId! : propertyOptions.length === 1 ? propertyOptions[0]!.id : '';
  const detail = useQuery({ queryKey: ['property', propertyId], queryFn: () => api<PropertyDetail>(`/properties/${propertyId}`), enabled: online && !!propertyId });
  const localBundles = bundles.filter((b) => b.building.propertyId === propertyId);
  const buildings = online && detail.data ? detail.data.buildings.map((b) => ({ id: b.id, name: b.name })) : localBundles.map((b) => ({ id: b.building.id, name: b.building.name }));
  const buildingId = buildings.some((b) => b.id === mem.buildingId) ? mem.buildingId! : buildings.length === 1 ? buildings[0]!.id : '';
  const assets: Asset[] = online && detail.data ? detail.data.assets : localBundles.flatMap((b) => b.assets);
  const products = useMemo(() => {
    if (online && catalog.data) return catalog.data.products;
    const fromBundles = bundles.flatMap((b) => b.products ?? []);
    const all = new Map<string, CatalogProduct>();
    for (const p of [...stored, ...fromBundles]) all.set(p.id, p);
    return [...all.values()];
  }, [online, catalog.data, bundles, stored]);
  const last = products.find((p) => p.id === mem.last?.productId) ?? null;

  const [text, setText] = useState('');
  const [pick, setPick] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);
  const a = useMemo(() => parseAnnouncement(text), [text]);
  const t = useMemo(() => resolveAnnouncedType(a, products, last), [a, products, last]);
  useEffect(() => setPick(null), [a.typeText, a.sameType]);
  const chosen = pick === 'unknown' ? null : pick ? (products.find((p) => p.id === pick) ?? null) : t.product;
  const unknown = pick === 'unknown' || (!pick && t.unknown);
  const needsPick = !pick && !t.product && t.candidates.length > 0;
  const category = chosen?.category || 'fire_door';
  const hit = a.number != null ? findAnnounced(a.number, assets, category, labelOf) : null;
  const existing = hit && 'asset' in hit ? hit.asset : null;
  const conflict = hit && 'conflict' in hit ? hit.conflict : null;

  const submit = async () => {
    setError('');
    if (a.number == null) return setError('Nummer fehlt – z. B. „Tür 354, Typ SK32“.');
    if (!propertyId) return setError(online ? 'Bitte zuerst das Objekt wählen.' : 'Ohne Netz: erst unter Offline ein Gebäude dieses Objekts laden.');
    if (conflict) return setError(`${conflict} – bitte Nummer prüfen.`);
    if (needsPick) return setError('Welcher Typ? Bitte unten wählen.');
    if (!existing && !buildingId) return setError('Bitte das Gebäude wählen.');
    setBusy(true);
    try {
      const def = getCategory(category);
      const typeNote = unknown && a.typeText ? rawNote(a.text, online ? 'app' : 'offline', 'type', { summary: `Typ „${a.typeText}“ nicht im Katalog` }) : undefined;
      const general = unknown && !existing;
      const next: Memory = { propertyId, buildingId, last: chosen ? { productId: chosen.id, label: productLabel(chosen) } : unknown ? { unknown: true } : mem.last };
      if (online) {
        let assetId = existing?.id;
        if (!assetId) {
          const body = announcedAssetBody(a, chosen, def.attributes.map((f) => f.key), category);
          try {
            assetId = (await api<{ id: string }>('/assets', { body: { buildingId, ...body } })).id;
          } catch (e) {
            // gleichzeitig angelegt: vorhandene Tür mit dieser Nummer nehmen
            if (!(e instanceof ApiError && e.status === 409)) throw e;
            const fresh = await api<PropertyDetail>(`/properties/${propertyId}`);
            const again = findAnnounced(a.number, fresh.assets, category, labelOf);
            if (!again || !('asset' in again)) throw e;
            assetId = again.asset.id;
          }
          void qc.invalidateQueries({ queryKey: ['property', propertyId] });
        }
        const r = await api<{ id: string }>(`/assets/${assetId}/inspections`, { body: { ...(general ? { general: true } : {}), ...(typeNote ? { rawNote: typeNote } : {}) } });
        remember(next);
        setText('');
        navigate(`/pruefung/${r.id}?ansage=1`, { state: { finding: t.finding } });
      } else {
        let assetId = existing?.id;
        if (!assetId) {
          const body = announcedAssetBody(a, chosen, def.attributes.map((f) => f.key), category);
          assetId = (await createLocalAsset(buildingId, body)).id;
        }
        remember(next);
        setText('');
        navigate(`/offline/pruefen/${encodeURIComponent(assetId)}?ansage=1`, { state: { finding: t.finding, general, rawNote: typeNote } });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ansage fehlgeschlagen');
    } finally {
      setBusy(false);
    }
  };

  // Vorschau in einem Satz
  let preview: { tone: 'muted' | 'bad' | 'ok' | 'warn'; text: string } | null = null;
  if (text.trim()) {
    if (a.number == null) preview = { tone: 'muted', text: 'Nummer fehlt – z. B. „Tür 354, Typ SK32“' };
    else if (conflict) preview = { tone: 'bad', text: conflict };
    else if (existing)
      preview = {
        tone: 'ok',
        text: `${existing.code} vorhanden · ${[existing.location, [existing.manufacturer, existing.model].filter(Boolean).join(' ')].filter(Boolean).join(' · ')}`,
      };
    else if (needsPick) preview = { tone: 'warn', text: `Tür ${a.number} · ${a.location} – welcher Typ?` };
    else
      preview = {
        tone: unknown ? 'warn' : 'ok',
        text: `Tür ${a.number} · ${a.location} · ${chosen ? productLabel(chosen) : 'Typ unbekannt – allgemeine Checkliste'} – wird angelegt`,
      };
  }
  const printable = chosen ?? (existing ? null : last);

  return (
    <Section title="Tür ansagen" aria-label="Tür ansagen" action={!online && <StatusText tone="info">ohne Netz</StatusText>}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className={clsx('grid gap-2', buildings.length > 1 && 'sm:grid-cols-2')}>
          <Select aria-label="Objekt" value={propertyId} onChange={(e) => remember({ propertyId: e.target.value, buildingId: '' })}>
            <option value="">{propertyOptions.length ? 'Objekt wählen …' : online ? 'Noch kein Objekt' : 'Kein Gebäude geladen'}</option>
            {propertyOptions.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
          {buildings.length > 1 && (
            <Select aria-label="Gebäude" value={buildingId} onChange={(e) => remember({ buildingId: e.target.value })}>
              <option value="">Gebäude wählen …</option>
              {buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        <div className="flex gap-2">
          <div className="min-w-0 flex-1">
            <DictateInput
              ref={inputRef}
              aria-label="Ansage"
              placeholder="Tür 354, Typ SK32"
              enterKeyHint="go"
              autoComplete="off"
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setError('');
              }}
            />
          </div>
          <Button type="submit" loading={busy} disabled={!text.trim()} icon={<ArrowRight />} className="shrink-0">
            Öffnen
          </Button>
        </div>
        {preview && (
          <p className="text-meta" role="status" aria-label="Vorschau der Ansage">
            <StatusText tone={preview.tone}>{preview.text}</StatusText>
            {t.finding && !conflict && <span className="text-ink-3"> · Befund: „{t.finding}“</span>}
          </p>
        )}
        {needsPick || pick ? (
          <div className="flex flex-wrap gap-2" role="group" aria-label="Typ wählen">
            {t.candidates.map((p) => (
              <ToggleChip key={p.id} active={pick === p.id} onClick={() => setPick(pick === p.id ? null : p.id)}>
                {productLabel(p)}
              </ToggleChip>
            ))}
            {t.candidates.length > 0 && (
              <ToggleChip active={pick === 'unknown'} onClick={() => setPick(pick === 'unknown' ? null : 'unknown')}>
                Typ unbekannt
              </ToggleChip>
            )}
          </div>
        ) : null}
        {error && (
          <p role="alert" className="text-meta text-shu">
            {error}
          </p>
        )}
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-3">
          <span className="min-w-0">
            {mem.last?.label ? (
              <>
                Letzter Typ: <span className="text-ink-2">{mem.last.label}</span> – „gleicher Typ“ übernimmt ihn
              </>
            ) : (
              'Nur sagen, was nicht stimmt – der Rest gilt als in Ordnung.'
            )}
          </span>
          {printable && (
            <Link to={`/druck/checkliste?produkt=${encodeURIComponent(printable.id)}`} className="inline-flex items-center gap-1 underline-offset-4 hover:text-ink hover:underline">
              <Printer className="size-3.5" /> Checkliste {printable.model}
            </Link>
          )}
        </p>
      </form>
    </Section>
  );
}

// Offline-Modus: Gebäude vorab laden, Prüfungen lokal erfassen, später synchronisieren.
import { createStore, del, get, keys, set } from 'idb-keyval';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { AnnounceAssetBody } from '../shared/announce';
import type { KnownDefect } from '../shared/carry';
import type { CatalogProduct, Checkpoint } from '../shared/catalog';
import { walkSort } from '../shared/walk-order';
import { api, ApiError, type Asset, type CategoryInfo, downscale, queryClient, uploadBlob } from './api';
import type { InspectionDraft } from './components/run';

const store = createStore('pruefkompass', 'offline');

export interface Bundle {
  building: { id: string; name: string; propertyId: string; propertyName: string };
  assets: Asset[];
  categories: CategoryInfo[];
  /** offene Mängel der Elemente (ältere Pakete haben keine) */
  openDefects?: (KnownDefect & { assetId: string })[];
  /** Katalog-Typen für „Tür ansagen“ ohne Netz (Plan v7 W; ältere Pakete haben keine) */
  products?: CatalogProduct[];
  preparedAt: number;
}

/** Ohne Netz angesagte Tür, die es auf dem Server noch nicht gibt (wird vor der Prüfung angelegt). */
export interface LocalAsset {
  /** „local:…“ – bis zur Übertragung die ID im Gerät */
  localId: string;
  propertyId: string;
  buildingId: string;
  body: AnnounceAssetBody;
}

export interface OutboxItem {
  clientId: string;
  assetId: string;
  code: string;
  buildingId: string;
  schedule?: string;
  checkpoints: Checkpoint[];
  draft: InspectionDraft;
  inspectedAt: number;
  error?: string;
  /** Plan v7 W: nur als Entwurf übertragen (ohne Unterschrift), `ready` = bereit zur Unterschrift */
  draftOnly?: boolean;
  ready?: boolean;
  /** Tür erst anlegen (offline angesagt) */
  newAsset?: LocalAsset;
}

// ---------- kleine Pub/Sub, damit UI auf Änderungen reagiert ----------
let version = 0;
const listeners = new Set<() => void>();
const bump = () => {
  version++;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useOfflineVersion = () => useSyncExternalStore(subscribe, () => version);

export function useOnline() {
  return useSyncExternalStore(
    (l) => {
      window.addEventListener('online', l);
      window.addEventListener('offline', l);
      return () => {
        window.removeEventListener('online', l);
        window.removeEventListener('offline', l);
      };
    },
    () => navigator.onLine,
  );
}

// ---------- Gebäude ----------
export async function prepareBuilding(buildingId: string): Promise<Bundle> {
  const b = await api<Bundle>(`/offline/buildings/${buildingId}`);
  // ohne Netz angesagte, noch nicht übertragene Türen bleiben im Paket
  const prev = await get<Bundle>(`bundle:${buildingId}`, store);
  const local = (prev?.assets ?? []).filter((a) => a.id.startsWith('local:'));
  await set(`bundle:${buildingId}`, { ...b, assets: [...b.assets, ...local] }, store);
  if (b.products) await cacheProducts(b.products);
  bump();
  return b;
}

// ---------- Katalog-Typen ohne Netz (Plan v7 W) ----------
/** Katalog-Typen merken (beim Laden eines Gebäudes und wenn die App den Katalog online lädt). */
export async function cacheProducts(products: CatalogProduct[]) {
  try {
    await set('catalog-products', products, store);
  } catch {
    /* ohne Speicher */
  }
}
export async function cachedProducts(): Promise<CatalogProduct[]> {
  try {
    return (await get<CatalogProduct[]>('catalog-products', store)) ?? [];
  } catch {
    return [];
  }
}

/** Ohne Netz angesagte Tür im geladenen Gebäude anlegen (wird mit der ersten Prüfung übertragen). */
export async function createLocalAsset(buildingId: string, body: AnnounceAssetBody): Promise<Asset> {
  const b = await get<Bundle>(`bundle:${buildingId}`, store);
  if (!b) throw new Error('Gebäude ist nicht auf dem Gerät geladen');
  const asset: Asset = {
    id: `local:${crypto.randomUUID()}`,
    code: `Nr. ${body.number}`,
    number: body.number,
    category: body.category,
    location: body.location,
    floor: '',
    manufacturer: body.manufacturer,
    model: body.model,
    attributes: body.attributes,
    lastInspectionId: null,
    lastInspectedAt: null,
    lastResult: null,
    nextDueAt: null,
    buildingId,
    buildingName: b.building.name,
    propertyId: b.building.propertyId,
    propertyName: b.building.propertyName,
    openDefects: 0,
    labelCode: null,
    schedules: { main: { enabled: true } },
    floorPlanId: null,
    markerX: null,
    markerY: null,
    createdAt: Date.now(),
  };
  await set(`bundle:${buildingId}`, { ...b, assets: [...b.assets, asset] }, store);
  bump();
  return asset;
}

/** Lokale Tür → Server-ID: anlegen (feste Nummer) oder, wenn die Nummer schon vergeben ist, die vorhandene nehmen. */
async function resolveLocalAsset(item: OutboxItem): Promise<string> {
  const map = (await get<Record<string, string>>('asset-map', store)) ?? {};
  const local = item.assetId;
  if (map[local]) return map[local];
  const na = item.newAsset;
  if (!na) throw new ApiError(400, 'Neue Tür ohne Angaben – bitte neu ansagen');
  let id: string;
  try {
    id = (await api<{ id: string }>('/assets', { body: { buildingId: na.buildingId, ...na.body } })).id;
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 409) throw e;
    // schon angelegt (früherer Versuch oder jemand anderes): Element mit dieser Nummer im Objekt
    const hit = await api<{ id: string; category: string }>(`/assets/by-code/${encodeURIComponent(String(na.body.number))}?propertyId=${encodeURIComponent(na.propertyId)}`);
    if (hit.category !== na.body.category) throw e;
    id = hit.id;
  }
  await set('asset-map', { ...map, [local]: id }, store);
  // im Paket und in der Warteschlange die lokale ID ersetzen
  const b = await get<Bundle>(`bundle:${na.buildingId}`, store);
  if (b) await set(`bundle:${na.buildingId}`, { ...b, assets: b.assets.map((a) => (a.id === local ? { ...a, id } : a)) }, store);
  await set(
    'outbox',
    (await getOutbox()).map((x) => (x.assetId === local ? { ...x, assetId: id } : x)),
    store,
  );
  return id;
}

export async function removeBuilding(buildingId: string) {
  await del(`bundle:${buildingId}`, store);
  bump();
}

export async function listBundles(): Promise<Bundle[]> {
  const ks = (await keys(store)).filter((k) => String(k).startsWith('bundle:'));
  const all = await Promise.all(ks.map((k) => get<Bundle>(k, store)));
  return all.filter(Boolean) as Bundle[];
}

export async function findAsset(assetId: string): Promise<{ bundle: Bundle; asset: Asset } | null> {
  for (const b of await listBundles()) {
    const a = b.assets.find((x) => x.id === assetId);
    if (a) return { bundle: b, asset: a };
  }
  return null;
}

// ---------- Entwürfe ----------
export const getDraft = (assetId: string, schedule = 'main') => get<InspectionDraft>(`draft:${assetId}:${schedule}`, store);
export const saveDraft = (assetId: string, schedule: string, d: InspectionDraft) => set(`draft:${assetId}:${schedule}`, d, store);
export const dropDraft = (assetId: string, schedule = 'main') => del(`draft:${assetId}:${schedule}`, store);

// ---------- Fotos ----------
export async function storePhoto(file: Blob): Promise<string> {
  const key = `local:${crypto.randomUUID()}`;
  await set(`photo:${key}`, await downscale(file, 1600), store);
  return key;
}

const urlCache = new Map<string, string>();
/** Synchroner Bild-URL für lokale Fotos; lädt nach und rendert über Versionszähler neu. */
export function localPhotoSrc(key: string): string {
  const hit = urlCache.get(key);
  if (hit) return hit;
  get<Blob>(`photo:${key}`, store).then((b) => {
    if (b && !urlCache.has(key)) {
      urlCache.set(key, URL.createObjectURL(b));
      bump();
    }
  });
  return 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';
}

// ---------- Warteschlange ----------
export async function getOutbox(): Promise<OutboxItem[]> {
  return (await get<OutboxItem[]>('outbox', store)) ?? [];
}

export async function enqueue(item: OutboxItem) {
  const box = await getOutbox();
  await set('outbox', [...box.filter((x) => x.clientId !== item.clientId), item], store);
  await dropDraft(item.assetId, item.schedule ?? 'main');
  bump();
}

export async function removeFromOutbox(clientId: string) {
  await set('outbox', (await getOutbox()).filter((x) => x.clientId !== clientId), store);
  bump();
}

let syncing: Promise<{ sent: number; failed: number; stored: number }> | null = null;

/** Alle wartenden Prüfungen übertragen. Fotos werden vorher hochgeladen. */
export function syncOutbox() {
  syncing ??= (async () => {
    let sent = 0;
    let failed = 0;
    /** vom Server abgelehnt und dort unter „Übertragungen prüfen“ aufbewahrt */
    let stored = 0;
    for (const item of await getOutbox()) {
      try {
        const upload = async (key?: string) => {
          if (!key?.startsWith('local:')) return key;
          const blob = await get<Blob>(`photo:${key}`, store);
          return blob ? await uploadBlob(blob) : undefined;
        };
        const defects = [];
        for (const d of item.draft.defects) defects.push({ ...d, photoKey: await upload(d.photoKey) });
        const photos = [];
        for (const p of item.draft.photos ?? []) {
          const key = await upload(p.key);
          if (key) photos.push({ ...p, key });
        }
        // Hochgeladene Fotos sofort im Eintrag vermerken, damit ein erneuter Versuch sie nicht noch einmal hochlädt
        const local = [...item.draft.defects.map((d) => d.photoKey), ...(item.draft.photos ?? []).map((p) => p.key)].filter((k) => k?.startsWith('local:'));
        if (local.length) {
          const updated = { ...item, draft: { ...item.draft, defects, photos } };
          await set('outbox', (await getOutbox()).map((x) => (x.clientId === item.clientId ? updated : x)), store);
          for (const k of local) await del(`photo:${k}`, store);
        }
        const assetId = item.assetId.startsWith('local:') ? await resolveLocalAsset(item) : item.assetId;
        await api('/inspections/offline', {
          body: {
            ...item.draft,
            defects,
            photos,
            clientId: item.clientId,
            assetId,
            schedule: item.schedule ?? 'main',
            inspectedAt: item.inspectedAt,
            checkpoints: item.checkpoints,
            rawNotes: item.draft.rawNotes ?? [],
            ...(item.draftOnly ? { draftOnly: true, ready: !!item.ready } : {}),
          },
        });
        await removeFromOutbox(item.clientId);
        sent++;
      } catch (e) {
        if (!(e instanceof ApiError)) break; // kein Netz: später erneut
        failed++;
        if (typeof e.data?.failureId === 'string') {
          // Der Server bewahrt die Prüfung auf (erneut versuchen oder löschen auf der Offline-Seite)
          stored++;
          await removeFromOutbox(item.clientId);
          continue;
        }
        const box = await getOutbox();
        await set('outbox', box.map((x) => (x.clientId === item.clientId ? { ...x, error: e.message } : x)), store);
        bump();
        if (e.status === 401) break;
      }
    }
    if (sent) await queryClient.invalidateQueries();
    if (stored) await queryClient.invalidateQueries({ queryKey: ['offline-failures'] });
    return { sent, failed, stored };
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

/** Hook: Anzahl wartender Prüfungen + automatische Synchronisation bei Verbindung (auch Erfasstes). */
export function useOutbox() {
  const v = useOfflineVersion();
  const online = useOnline();
  const [items, setItems] = useState<OutboxItem[]>([]);
  const [captures, setCaptures] = useState<CaptureOp[]>([]);
  useEffect(() => {
    getOutbox().then(setItems);
    getCaptures().then(setCaptures);
  }, [v]);
  useEffect(() => {
    if (online && items.some((i) => !i.error)) void syncOutbox();
  }, [online, items]);
  useEffect(() => {
    if (online && captures.some((i) => !i.error && !i.duplicate)) void syncCaptures();
  }, [online, captures]);
  return items;
}

// ---------- Erfasstes (Mängel, Aufgaben, Elemente) ohne Netz ----------
/** Ein vorbereiteter Aufruf aus „Erfassen“: wird bei Verbindung an den bestehenden Endpunkt gesendet. */
export interface CaptureOp {
  clientId: string;
  kind: 'defect' | 'task' | 'asset';
  /** Anzeige in der Warteschlange */
  title: string;
  path: '/defects' | '/tasks' | '/assets';
  body: Record<string, unknown>;
  createdAt: number;
  /** vom Server abgelehnt (nicht 409) */
  error?: string;
  /** ähnlicher offener Mangel vorhanden (409) – „Trotzdem anlegen“ oder verwerfen */
  duplicate?: string;
}

export async function getCaptures(): Promise<CaptureOp[]> {
  return (await get<CaptureOp[]>('captures', store)) ?? [];
}

export async function enqueueCaptures(ops: CaptureOp[]) {
  if (!ops.length) return;
  const box = await getCaptures();
  await set('captures', [...box.filter((x) => !ops.some((o) => o.clientId === x.clientId)), ...ops], store);
  bump();
}

export async function removeCapture(clientId: string) {
  await set('captures', (await getCaptures()).filter((x) => x.clientId !== clientId), store);
  bump();
}

async function patchCapture(clientId: string, patch: Partial<CaptureOp>) {
  await set('captures', (await getCaptures()).map((x) => (x.clientId === clientId ? { ...x, ...patch } : x)), store);
  bump();
}

/** Ein Eintrag senden; `force` legt einen als Duplikat gemeldeten Mangel trotzdem an. */
export async function sendCapture(op: CaptureOp, force = false): Promise<'sent' | 'duplicate' | 'failed' | 'offline'> {
  try {
    await api(op.path, { body: force ? { ...op.body, force: true } : op.body });
    await removeCapture(op.clientId);
    return 'sent';
  } catch (e) {
    if (!(e instanceof ApiError)) return 'offline';
    if (e.status === 409 && op.kind === 'defect') {
      await patchCapture(op.clientId, { duplicate: e.message, error: undefined });
      return 'duplicate';
    }
    await patchCapture(op.clientId, { error: e.message });
    return 'failed';
  }
}

let syncingCaptures: Promise<{ sent: number; duplicates: number; failed: number }> | null = null;

/** Wartendes Erfasstes übertragen; Duplikate (409) bleiben zur Entscheidung auf der Offline-Seite stehen. */
export function syncCaptures() {
  syncingCaptures ??= (async () => {
    let sent = 0;
    let duplicates = 0;
    let failed = 0;
    for (const op of await getCaptures()) {
      if (op.error || op.duplicate) continue;
      const r = await sendCapture(op);
      if (r === 'offline') break;
      if (r === 'sent') sent++;
      else if (r === 'duplicate') duplicates++;
      else failed++;
    }
    if (sent) for (const k of ['defects', 'tasks', 'dashboard', 'smart', 'asset', 'assets', 'now']) void queryClient.invalidateQueries({ queryKey: [k] });
    return { sent, duplicates, failed };
  })().finally(() => {
    syncingCaptures = null;
  });
  return syncingCaptures;
}

export function useCaptureQueue() {
  const v = useOfflineVersion();
  const [items, setItems] = useState<CaptureOp[]>([]);
  useEffect(() => {
    getCaptures().then(setItems);
  }, [v]);
  return items;
}

/** Elemente aller geladenen Gebäude – Ortswahl in „Erfassen“, wenn die Elementliste ohne Netz fehlt. */
export function useLocalAssets(enabled: boolean) {
  const v = useOfflineVersion();
  const [assets, setAssets] = useState<Asset[] | undefined>(undefined);
  useEffect(() => {
    if (enabled) listBundles().then((bs) => setAssets(bs.flatMap((b) => b.assets)));
  }, [v, enabled]);
  return assets;
}

/** Ist der Fehler „kein Netz“ (statt einer Antwort des Servers)? */
export const isNetworkError = (e: unknown) => !(e instanceof ApiError);

// ---------- Rundgang ohne Netz ----------
const DAY = 86_400_000;
/** Fällige Elemente eines geladenen Gebäudes (überfällig, nie geprüft oder in 14 Tagen fällig) in Laufreihenfolge (shared/walk-order.ts). */
export function walkOrder(bundle: Bundle, now = Date.now()): Asset[] {
  // dieselbe Laufreihenfolge wie Rundgang-API und Claude (tour): Etagen von unten nach oben, dann Anlage-Reihenfolge
  return walkSort(bundle.assets.filter((a) => a.nextDueAt == null || a.nextDueAt < now + 14 * DAY));
}

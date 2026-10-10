// Offline-Modus: Gebäude vorab laden, Prüfungen lokal erfassen, später synchronisieren.
import { createStore, del, get, keys, set } from 'idb-keyval';
import { useEffect, useState, useSyncExternalStore } from 'react';
import type { Checkpoint } from '../shared/catalog';
import { api, ApiError, type Asset, downscale, queryClient, type Template, uploadBlob } from './api';
import type { InspectionDraft } from './components/run';

const store = createStore('pruefkompass', 'offline');

export interface Bundle {
  building: { id: string; name: string; propertyId: string; propertyName: string };
  assets: Asset[];
  templates: Template[];
  preparedAt: number;
}

export interface OutboxItem {
  clientId: string;
  assetId: string;
  code: string;
  buildingId: string;
  checkpoints: Checkpoint[];
  draft: InspectionDraft;
  inspectedAt: number;
  error?: string;
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
  await set(`bundle:${buildingId}`, b, store);
  bump();
  return b;
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
export const getDraft = (assetId: string) => get<InspectionDraft>(`draft:${assetId}`, store);
export const saveDraft = (assetId: string, d: InspectionDraft) => set(`draft:${assetId}`, d, store);
export const dropDraft = (assetId: string) => del(`draft:${assetId}`, store);

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
  await dropDraft(item.assetId);
  bump();
}

export async function removeFromOutbox(clientId: string) {
  await set('outbox', (await getOutbox()).filter((x) => x.clientId !== clientId), store);
  bump();
}

let syncing: Promise<{ sent: number; failed: number }> | null = null;

/** Alle wartenden Prüfungen übertragen. Fotos werden vorher hochgeladen. */
export function syncOutbox() {
  syncing ??= (async () => {
    let sent = 0;
    let failed = 0;
    for (const item of await getOutbox()) {
      try {
        const defects = [];
        for (const d of item.draft.defects) {
          if (d.photoKey?.startsWith('local:')) {
            const blob = await get<Blob>(`photo:${d.photoKey}`, store);
            defects.push({ ...d, photoKey: blob ? await uploadBlob(blob) : undefined });
          } else defects.push(d);
        }
        await api('/inspections/offline', {
          body: { ...item.draft, defects, clientId: item.clientId, assetId: item.assetId, inspectedAt: item.inspectedAt, checkpoints: item.checkpoints },
        });
        for (const d of item.draft.defects) if (d.photoKey?.startsWith('local:')) await del(`photo:${d.photoKey}`, store);
        await removeFromOutbox(item.clientId);
        sent++;
      } catch (e) {
        if (!(e instanceof ApiError)) break; // kein Netz: später erneut
        failed++;
        const box = await getOutbox();
        await set('outbox', box.map((x) => (x.clientId === item.clientId ? { ...x, error: e.message } : x)), store);
        bump();
        if (e.status === 401) break;
      }
    }
    if (sent) await queryClient.invalidateQueries();
    return { sent, failed };
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

/** Hook: Anzahl wartender Prüfungen + automatische Synchronisation bei Verbindung. */
export function useOutbox() {
  const v = useOfflineVersion();
  const online = useOnline();
  const [items, setItems] = useState<OutboxItem[]>([]);
  useEffect(() => {
    getOutbox().then(setItems);
  }, [v]);
  useEffect(() => {
    if (online && items.some((i) => !i.error)) void syncOutbox();
  }, [online, items]);
  return items;
}

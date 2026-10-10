import { QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Category, Checkpoint, InspectionKind, Role, Severity } from '../shared/catalog';
import type { Answer, Result } from '../shared/logic';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown; raw?: BodyInit; type?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { 'x-pk': '1' };
  let body: BodyInit | undefined;
  if (init.raw) {
    body = init.raw;
    if (init.type) headers['content-type'] = init.type;
  } else if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers['content-type'] = 'application/json';
  }
  const res = await fetch(`/api${path}`, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body, credentials: 'same-origin' });
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg;
    } catch {
      /* keine JSON-Antwort */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2,
    },
  },
});

// ---------- Typen ----------
export interface Me {
  user: { id: string; name: string; email: string; role: Role };
  tenant: { id: string; name: string };
  workspaces: { id: string; name: string; role: Role }[];
}

export interface PropertyRow {
  id: string;
  name: string;
  address: string;
  contactName: string;
  assets: number;
  overdue: number | null;
  soon: number | null;
  never: number | null;
  openDefects: number;
  lastInspectedAt: number | null;
  nextDueAt: number | null;
}

export interface Asset {
  id: string;
  code: string;
  category: Category;
  location: string;
  floor: string;
  manufacturer: string;
  model: string;
  attributes: Record<string, string | number | boolean | null>;
  lastInspectionId: string | null;
  lastInspectedAt: number | null;
  lastResult: Result | null;
  nextDueAt: number | null;
  buildingId: string;
  buildingName: string;
  propertyId: string;
  propertyName: string;
  openDefects: number;
}

export interface AssetDetail extends Asset {
  inspections: { id: string; kind: InspectionKind; status: string; result: Result | null; inspectedAt: number | null; createdAt: number; inspector: string }[];
  defects: Defect[];
}

export interface PropertyDetail {
  id: string;
  name: string;
  address: string;
  description: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  buildings: { id: string; name: string; address: string }[];
  assets: Asset[];
}

export interface Defect {
  id: string;
  title: string;
  note: string;
  severity: Severity;
  status: 'open' | 'resolved';
  createdAt: number;
  resolvedAt: number | null;
  inspectionId: string | null;
  photoKey?: string | null;
  assetId?: string;
  code?: string;
  category?: Category;
  location?: string;
  buildingName?: string;
  propertyId?: string;
  propertyName?: string;
  taskId?: string | null;
}

export interface DefectDraft {
  checkpointId?: string;
  title: string;
  note: string;
  severity: Severity;
  photoKey?: string;
}

export interface Inspection {
  id: string;
  assetId: string;
  status: 'draft' | 'submitted';
  kind: InspectionKind;
  result: Result | null;
  answers: Record<string, Answer>;
  maintenance: string[];
  defects: DefectDraft[];
  notInspectable: boolean;
  checkpoints: Checkpoint[];
  notes: string;
  signature: string | null;
  signerName: string;
  inspectorId: string;
  inspectorName: string;
  inspectedAt: number | null;
  nextDueAt: number | null;
  createdAt: number;
  tenantName: string;
  asset: {
    code: string;
    category: Category;
    location: string;
    floor: string;
    manufacturer: string;
    model: string;
    attributes: Record<string, string | number | boolean | null>;
    buildingName: string;
    buildingAddress: string;
    propertyName: string;
    propertyAddress: string;
  };
}

export interface InspectionRow {
  id: string;
  kind: InspectionKind;
  status: 'draft' | 'submitted';
  result: Result | null;
  inspectedAt: number | null;
  createdAt: number;
  nextDueAt: number | null;
  assetId: string;
  code: string;
  category: Category;
  location: string;
  buildingName: string;
  propertyName: string;
  inspector: string;
}

export interface Task {
  id: string;
  title: string;
  description: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'medium' | 'high';
  dueAt: number | null;
  assigneeId: string | null;
  assigneeName: string | null;
  assetId: string | null;
  assetCode: string | null;
  defectId: string | null;
  createdAt: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: number;
}

export interface Template {
  key: Category;
  label: string;
  norm: string;
  intervalMonths: number;
  customized: boolean;
  checkpoints: Checkpoint[];
}

export interface Dashboard {
  counts: {
    properties: number;
    assets: number;
    overdue: number;
    soon: number;
    never: number;
    notInspectable: number;
    openDefects: number;
    criticalDefects: number;
    inspections30d: number;
    drafts: number;
  };
  properties: PropertyRow[];
  recent: { id: string; result: Result; inspectedAt: number; code: string; category: Category; location: string; inspector: string }[];
  tasks: { id: string; title: string; priority: Task['priority']; dueAt: number | null; status: Task['status'] }[];
}

// ---------- Hooks ----------
export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/account/me'), retry: false, staleTime: 60_000 });
export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard') });
export const useProperties = () => useQuery({ queryKey: ['properties'], queryFn: () => api<PropertyRow[]>('/properties') });
export const useProperty = (id: string) => useQuery({ queryKey: ['property', id], queryFn: () => api<PropertyDetail>(`/properties/${id}`) });
export const useAssets = (params: Record<string, string | undefined> = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: ['assets', qs], queryFn: () => api<Asset[]>(`/assets${qs ? `?${qs}` : ''}`) });
};
export const useAsset = (id: string) => useQuery({ queryKey: ['asset', id], queryFn: () => api<AssetDetail>(`/assets/${id}`) });
export const useInspections = (status?: string) =>
  useQuery({ queryKey: ['inspections', status ?? 'all'], queryFn: () => api<InspectionRow[]>(`/inspections${status ? `?status=${status}` : ''}`) });
export const useInspection = (id: string) => useQuery({ queryKey: ['inspection', id], queryFn: () => api<Inspection>(`/inspections/${id}`) });
export const useDefects = (status = 'open') => useQuery({ queryKey: ['defects', status], queryFn: () => api<Defect[]>(`/defects?status=${status}`) });
export const useTasks = () => useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/tasks') });
export const useMembers = () =>
  useQuery({
    queryKey: ['members'],
    queryFn: () => api<{ members: Member[]; invites: { id: string; email: string; role: Role; token: string; createdAt: number }[] }>('/account/members'),
  });
export const useTemplates = () => useQuery({ queryKey: ['templates'], queryFn: () => api<Template[]>('/templates'), staleTime: 5 * 60_000 });

/** Mutation, die nach Erfolg die üblichen Listen neu lädt. */
export function useAction<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, onSuccess?: (r: TRes, v: TVars) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, v) => {
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' && q.queryKey[0] !== 'templates' });
      onSuccess?.(r, v);
    },
  });
}

export async function uploadPhoto(file: File): Promise<string> {
  const blob = await downscale(file, 1600);
  const r = await api<{ key: string }>('/files', { method: 'POST', raw: blob, type: blob.type });
  return r.key;
}

async function downscale(file: File, max: number): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    return await new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/jpeg', 0.85));
  } catch {
    return file;
  }
}

export const fileUrl = (key: string) => `/api/files/${key}`;

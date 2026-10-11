import { keepPreviousData, QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttributeField, Category, CategoryDef, Checkpoint, CustomKind, InspectionKind, InspectionPurpose, Role, Severity, WalkPurpose } from '../shared/catalog';
import type { Answer, Result, ResultOverride, Schedules } from '../shared/logic';
import type { BuildingType, WalkQuestion } from '../shared/walkthrough';

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
export interface Tenant {
  id: string;
  name: string;
  logoKey: string | null;
  address: string;
  phone: string;
  email: string;
  website: string;
  pdfPattern: string;
  archiveAfterMonths: number | null;
  /** Sprache erzeugter Dokumente */
  language: 'de' | 'en';
  timeZone: string;
  /** Erinnerung so viele Tage vor Fälligkeit (null = aus) */
  reminderDays: number | null;
  /** eigene Prüfungsarten */
  inspectionKinds: CustomKind[];
}

export interface Me {
  user: { id: string; name: string; email: string; role: Role; scoped?: boolean; canCreate?: boolean };
  tenant: Tenant;
  workspaces: { id: string; name: string; role: Role }[];
  pendingLegal: string[];
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
  buildingType: BuildingType;
  lastWalkAt: number | null;
  nextWalkAt: number | null;
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
  labelCode: string | null;
  schedules: Schedules;
  floorPlanId: string | null;
  markerX: number | null;
  markerY: number | null;
}

export interface Attachment {
  id: string;
  fileKey: string;
  name: string;
  contentType: string;
  size: number;
  caption: string;
  inspectionId: string | null;
  createdAt: number;
}

export interface AssetDetail extends Asset {
  inspections: {
    id: string;
    kind: InspectionKind;
    kinds: string[];
    purpose: InspectionPurpose;
    supersededAt: number | null;
    schedule: string;
    status: string;
    result: Result | null;
    inspectedAt: number | null;
    createdAt: number;
    archivedAt: number | null;
    inspector: string;
  }[];
  defects: Defect[];
  floorPlan: { id: string; name: string; width: number; height: number; fileKey: string } | null;
  attachments: Attachment[];
}

export interface FireOfficer {
  id: string;
  name: string;
  company: string;
  phone: string;
  email: string;
  qualification: string;
  appointedFrom: number;
  appointedTo: number | null;
  notes: string;
}

export interface FloorPlanRow {
  id: string;
  buildingId: string;
  name: string;
  level: number;
  width: number;
  height: number;
  fileKey: string;
  markers: number;
}

export interface FloorPlan {
  id: string;
  name: string;
  level: number;
  width: number;
  height: number;
  fileKey: string;
  buildingId: string;
  buildingName: string;
  propertyId: string;
  propertyName: string;
  assets: Asset[];
  siblings: { id: string; name: string; level: number }[];
}

export interface WalkRow {
  id: string;
  status: 'draft' | 'submitted';
  purpose?: WalkPurpose;
  followUpOf?: string | null;
  result: Result | null;
  buildingType?: BuildingType;
  inspectedAt: number | null;
  createdAt: number;
  nextDueAt: number | null;
  inspector: string;
  openDefects: number;
  propertyId?: string;
  propertyName?: string;
  buildingName?: string | null;
}

export interface Finding {
  questionId?: string;
  title: string;
  note: string;
  measure?: string;
  severity: Severity;
  photoKey?: string;
}

export interface Walkthrough {
  id: string;
  propertyId: string;
  buildingId: string | null;
  buildingType: BuildingType;
  purpose: WalkPurpose;
  followUpOf: string | null;
  followUpDate: number | null;
  /** Status der durchführenden Person beim Abschluss; null = unbekannt (Entwurf oder älter) */
  inspectorFireOfficer: boolean | null;
  inspectorQualification: string;
  status: 'draft' | 'submitted';
  result: Result | null;
  questions: WalkQuestion[];
  answers: Record<string, Answer>;
  findings: Finding[];
  notes: string;
  participants: string;
  signature: string | null;
  signerName: string;
  inspectorId: string;
  inspectorName: string;
  inspectedAt: number | null;
  nextDueAt: number | null;
  createdAt: number;
  propertyName: string;
  propertyAddress: string;
  buildingName: string | null;
  tenantName: string;
}

export interface Subcontractor {
  id: string;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  trade: string;
  notes: string;
  openTasks: number;
  doneTasks: number;
}

export interface PropertyDetail {
  id: string;
  name: string;
  address: string;
  description: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  buildingType: BuildingType;
  pdfPattern: string | null;
  fireOfficers: FireOfficer[];
  buildings: { id: string; name: string; address: string }[];
  floorPlans: FloorPlanRow[];
  walkthroughs: WalkRow[];
  assets: Asset[];
}

export interface Defect {
  id: string;
  title: string;
  note: string;
  measure?: string;
  severity: Severity;
  status: 'open' | 'resolved';
  createdAt: number;
  resolvedAt: number | null;
  inspectionId: string | null;
  walkthroughId?: string | null;
  legalBasis?: string;
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
  measure?: string;
  severity: Severity;
  photoKey?: string;
}

export interface InspectionPhoto {
  key: string;
  caption: string;
}

export interface Inspection {
  id: string;
  assetId: string;
  propertyId: string;
  status: 'draft' | 'submitted';
  kind: InspectionKind;
  kinds: string[];
  kindLabels: string[];
  purpose: InspectionPurpose;
  supersedesId: string | null;
  supersedesDate: number | null;
  supersededBy: string | null;
  supersededAt: number | null;
  supersededByDate: number | null;
  followUpOf: string | null;
  followUpDate: number | null;
  schedule: string;
  scheduleLabel: string;
  photos: InspectionPhoto[];
  archivedAt: number | null;
  propertyPdfPattern: string | null;
  result: Result | null;
  answers: Record<string, Answer>;
  maintenance: string[];
  defects: DefectDraft[];
  notInspectable: boolean;
  resultOverride: ResultOverride | null;
  resultReason: string;
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
    categoryLabel: string;
    norm: string;
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
  kinds: string[];
  purpose: InspectionPurpose;
  supersededAt: number | null;
  supersededBy: string | null;
  supersedesId: string | null;
  inspectorId: string;
  buildingId: string;
  schedule: string;
  archivedAt: number | null;
  propertyId: string;
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
  subcontractorId: string | null;
  subcontractorName: string | null;
  shareToken: string | null;
  externalNote: string;
  externalDoneAt: number | null;
  propertyId: string | null;
  propertyName: string | null;
  labels: string[];
  comments: number;
  firstResponseAt: number | null;
  closedAt: number | null;
  sla: { responseDue: number; resolveDue: number; responseBreached: boolean; resolveBreached: boolean };
  createdAt: number;
}

export interface TaskLabel {
  id: string;
  name: string;
  color: string;
  used: number;
}

export type SlaPolicies = Record<'high' | 'medium' | 'low', { responseHours: number; resolutionHours: number; custom: boolean }>;

export interface TaskComment {
  id: string;
  userId: string | null;
  authorName: string;
  body: string;
  createdAt: number;
}

export interface TaskStats {
  days: number;
  backlog: { open: number; overdue: number; byStatus: Record<string, number>; byPriority: Record<string, number> };
  throughput: { created: number; closed: number };
  resolution: { avgResolutionMs: number | null; avgResponseMs: number | null };
  sla: { total: number; compliant: number; breached: number; compliancePct: number | null };
  workload: { name: string; open: number; overdue: number }[];
}

export interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  link: string | null;
  readAt: number | null;
  createdAt: number;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  joinedAt: number;
  /** null = gesamter Workspace */
  scope: { propertyIds: string[]; buildingIds: string[] } | null;
  canCreate: boolean;
  fireOfficer: boolean;
  fireOfficerQualification: string;
}

export interface EffectiveSchedule {
  key: string;
  label: string;
  intervalMonths: number;
  optional: boolean;
  checkpoints: Checkpoint[];
  customized: boolean;
}

export interface CategoryInfo extends CategoryDef {
  customized: boolean;
  schedulesEffective: EffectiveSchedule[];
  attributes: AttributeField[];
}
/** @deprecated alter Name */
export type Template = CategoryInfo;

export interface Dashboard {
  counts: {
    properties: number;
    assets: number;
    overdue: number;
    soon: number;
    never: number;
    notInspectable: number;
    newAssets: number;
    openDefects: number;
    criticalDefects: number;
    inspections30d: number;
    drafts: number;
    openWalkDefects: number;
    walkDue: number;
  };
  properties: PropertyRow[];
  recent: { id: string; result: Result; inspectedAt: number; code: string; category: Category; location: string; inspector: string }[];
  tasks: { id: string; title: string; priority: Task['priority']; dueAt: number | null; status: Task['status'] }[];
}

// ---------- Hooks ----------
const ME_CACHE = 'pk:me';
/** Angemeldete Person. Ohne Netz wird die zuletzt bekannte Sitzung verwendet (Offline-Modus). */
export const useMe = () =>
  useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        const me = await api<Me>('/account/me');
        localStorage.setItem(ME_CACHE, JSON.stringify(me));
        return me;
      } catch (e) {
        if (e instanceof ApiError) {
          if (e.status === 401) localStorage.removeItem(ME_CACHE);
          throw e;
        }
        const cached = localStorage.getItem(ME_CACHE);
        if (cached) return JSON.parse(cached) as Me;
        throw e;
      }
    },
    retry: false,
    staleTime: 60_000,
  });
export const clearMeCache = () => localStorage.removeItem(ME_CACHE);
export const useDashboard = () => useQuery({ queryKey: ['dashboard'], queryFn: () => api<Dashboard>('/dashboard') });
export const useProperties = () => useQuery({ queryKey: ['properties'], queryFn: () => api<PropertyRow[]>('/properties') });
export const useProperty = (id: string) => useQuery({ queryKey: ['property', id], queryFn: () => api<PropertyDetail>(`/properties/${id}`) });
export const useAssets = (params: Record<string, string | undefined> = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: ['assets', qs], queryFn: () => api<Asset[]>(`/assets${qs ? `?${qs}` : ''}`) });
};
export const useAsset = (id: string) => useQuery({ queryKey: ['asset', id], queryFn: () => api<AssetDetail>(`/assets/${id}`) });
export const useInspections = (params: Record<string, string | undefined> = {}) => {
  const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v) as [string, string][]).toString();
  return useQuery({ queryKey: ['inspections', qs], queryFn: () => api<InspectionRow[]>(`/inspections?${qs}`), placeholderData: keepPreviousData });
};
export const useInspection = (id: string) => useQuery({ queryKey: ['inspection', id], queryFn: () => api<Inspection>(`/inspections/${id}`) });
export const useDefects = (status = 'open', source = '') =>
  useQuery({ queryKey: ['defects', status, source], queryFn: () => api<Defect[]>(`/defects?status=${status}${source ? `&source=${source}` : ''}`) });
export const useWalkthroughs = () => useQuery({ queryKey: ['walkthroughs'], queryFn: () => api<WalkRow[]>('/walkthroughs') });
export const useWalkthrough = (id: string) => useQuery({ queryKey: ['walkthrough', id], queryFn: () => api<Walkthrough>(`/walkthroughs/${id}`) });
export const useFloorPlan = (id: string) => useQuery({ queryKey: ['floorplan', id], queryFn: () => api<FloorPlan>(`/floor-plans/${id}`) });
export const useSubcontractors = () => useQuery({ queryKey: ['subcontractors'], queryFn: () => api<Subcontractor[]>('/subcontractors') });
export const useTasks = () => useQuery({ queryKey: ['tasks'], queryFn: () => api<Task[]>('/tasks') });
export const useMembers = () =>
  useQuery({
    queryKey: ['members'],
    queryFn: () => api<{ members: Member[]; invites: { id: string; email: string; role: Role; token: string; createdAt: number }[] }>('/account/members'),
  });
export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: () => api<CategoryInfo[]>('/categories'), staleTime: 5 * 60_000 });
export const useNotifications = () =>
  useQuery({ queryKey: ['notifications'], queryFn: () => api<{ items: Notification[]; unread: number }>('/notifications'), refetchInterval: 60_000 });
export const useTaskLabels = () => useQuery({ queryKey: ['task-labels'], queryFn: () => api<TaskLabel[]>('/tasks/labels') });
export const useSla = () => useQuery({ queryKey: ['sla'], queryFn: () => api<SlaPolicies>('/tasks/sla-policies') });
export const useTaskStats = (days: number) => useQuery({ queryKey: ['task-stats', days], queryFn: () => api<TaskStats>(`/tasks/stats?days=${days}`) });
export const useTaskComments = (id: string | undefined) =>
  useQuery({ queryKey: ['task-comments', id], queryFn: () => api<TaskComment[]>(`/tasks/${id}/comments`), enabled: !!id });

/** Mutation, die nach Erfolg die üblichen Listen neu lädt. */
export function useAction<TVars, TRes = unknown>(fn: (v: TVars) => Promise<TRes>, onSuccess?: (r: TRes, v: TVars) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r, v) => {
      await qc.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
      onSuccess?.(r, v);
    },
  });
}

export async function uploadPhoto(file: Blob): Promise<string> {
  return uploadBlob(await downscale(file, 1600));
}

export async function uploadBlob(blob: Blob): Promise<string> {
  const r = await api<{ key: string }>('/files', { method: 'POST', raw: blob, type: blob.type || 'image/jpeg' });
  return r.key;
}

export async function downscale(file: Blob, max: number): Promise<Blob> {
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

export interface SearchResult {
  properties: { id: string; name: string; address: string }[];
  buildings: { id: string; name: string; propertyId: string; propertyName: string }[];
  assets: { id: string; code: string; category: Category; location: string; buildingName: string; propertyName: string }[];
}

// ---------- Berichtsarchiv ----------
export type ReportKind = 'compliance' | 'defects' | 'property' | 'protocols' | 'selection' | 'annual';
export interface ReportRow {
  id: string;
  kind: ReportKind;
  title: string;
  fileName: string;
  contentType: string;
  size: number;
  propertyId: string | null;
  createdAt: number;
  createdBy: string | null;
  createdById: string | null;
}
export const useReports = () => useQuery({ queryKey: ['reports'], queryFn: () => api<ReportRow[]>('/reports') });

/** Erzeugten Bericht zusätzlich im Archiv ablegen (Lesezugriff darf nicht archivieren). */
export async function archiveReport(me: Me, bytes: Uint8Array, meta: { kind: ReportKind; title: string; fileName: string; propertyId?: string }, type = 'application/pdf') {
  if (me.user.role === 'viewer') return false;
  const qs = new URLSearchParams({ kind: meta.kind, title: meta.title, fileName: meta.fileName, ...(meta.propertyId ? { propertyId: meta.propertyId } : {}) });
  await api(`/reports?${qs}`, { method: 'POST', raw: new Blob([bytes as BlobPart], { type }), type });
  queryClient.invalidateQueries({ queryKey: ['reports'] });
  return true;
}

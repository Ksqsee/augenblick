import { useQuery } from '@tanstack/react-query';
import { INSPECTION_KINDS } from '../../shared/catalog';
import { api, type PropertyDetail, useMe, useMembers, useProperties } from '../api';
import { allCategories } from '../categories';
import { RESULT_META } from '../format';
import { Input, Select } from './ui';

/** Filter für Prüfungslisten und den Berichtsgenerator (Werte wie die Query-Parameter von GET /inspections). */
export interface InspectionFilter {
  period: '' | 'year' | 'last_year' | '12m' | '30d' | 'custom';
  from: string;
  to: string;
  propertyId: string;
  buildingId: string;
  category: string;
  result: string;
  inspectorId: string;
  kind: string;
  q: string;
}

export const EMPTY_FILTER: InspectionFilter = { period: '', from: '', to: '', propertyId: '', buildingId: '', category: '', result: '', inspectorId: '', kind: '', q: '' };

const PERIODS: [InspectionFilter['period'], string][] = [
  ['', 'Gesamter Zeitraum'],
  ['30d', 'Letzte 30 Tage'],
  ['12m', 'Letzte 12 Monate'],
  ['year', 'Dieses Jahr'],
  ['last_year', 'Letztes Jahr'],
  ['custom', 'Eigener Zeitraum'],
];

const DAY = 86_400_000;

/** Zeitraum in Millisekunden (inklusive Endtag). */
export function periodRange(f: InspectionFilter, now = Date.now()): { from?: number; to?: number } {
  const y = new Date(now).getFullYear();
  switch (f.period) {
    case '30d':
      return { from: now - 30 * DAY };
    case '12m':
      return { from: now - 365 * DAY };
    case 'year':
      return { from: new Date(y, 0, 1).getTime() };
    case 'last_year':
      return { from: new Date(y - 1, 0, 1).getTime(), to: new Date(y, 0, 1).getTime() - 1 };
    case 'custom':
      return {
        from: f.from ? new Date(`${f.from}T00:00:00`).getTime() : undefined,
        to: f.to ? new Date(`${f.to}T23:59:59.999`).getTime() : undefined,
      };
    default:
      return {};
  }
}

/** Query-Parameter für GET /inspections. */
export function filterParams(f: InspectionFilter): Record<string, string | undefined> {
  const r = periodRange(f);
  return {
    from: r.from != null ? String(r.from) : undefined,
    to: r.to != null ? String(r.to) : undefined,
    propertyId: f.propertyId || undefined,
    buildingId: f.buildingId || undefined,
    category: f.category || undefined,
    result: f.result || undefined,
    inspectorId: f.inspectorId || undefined,
    kind: f.kind || undefined,
    q: f.q.trim() || undefined,
  };
}

export function InspectionFilters({ value, onChange, search = true }: { value: InspectionFilter; onChange: (f: InspectionFilter) => void; search?: boolean }) {
  const { data: me } = useMe();
  const props = useProperties();
  const members = useMembers();
  const detail = useQuery({ queryKey: ['property', value.propertyId], queryFn: () => api<PropertyDetail>(`/properties/${value.propertyId}`), enabled: !!value.propertyId });
  const set = (patch: Partial<InspectionFilter>) => onChange({ ...value, ...patch });
  const kinds: [string, string][] = [...Object.entries(INSPECTION_KINDS), ...(me?.tenant.inspectionKinds ?? []).map((k) => [k.key, k.label] as [string, string])];
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
      {search && <Input aria-label="Suche in Prüfungen" placeholder="Suche: Code, Standort, Gebäude …" value={value.q} onChange={(e) => set({ q: e.target.value })} className="sm:col-span-2" />}
      <Select aria-label="Zeitraum" value={value.period} onChange={(e) => set({ period: e.target.value as InspectionFilter['period'] })}>
        {PERIODS.map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
      {value.period === 'custom' && (
        <div className="flex gap-2">
          <Input type="date" aria-label="Von" value={value.from} onChange={(e) => set({ from: e.target.value })} />
          <Input type="date" aria-label="Bis" value={value.to} onChange={(e) => set({ to: e.target.value })} />
        </div>
      )}
      <Select aria-label="Objekt" value={value.propertyId} onChange={(e) => set({ propertyId: e.target.value, buildingId: '' })}>
        <option value="">Alle Objekte</option>
        {props.data?.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </Select>
      {value.propertyId && (
        <Select aria-label="Gebäude" value={value.buildingId} onChange={(e) => set({ buildingId: e.target.value })}>
          <option value="">Alle Gebäude</option>
          {detail.data?.buildings.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </Select>
      )}
      <Select aria-label="Elementart" value={value.category} onChange={(e) => set({ category: e.target.value })}>
        <option value="">Alle Elementarten</option>
        {allCategories().map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </Select>
      <Select aria-label="Ergebnis" value={value.result} onChange={(e) => set({ result: e.target.value })}>
        <option value="">Alle Ergebnisse</option>
        {Object.entries(RESULT_META).map(([k, v]) => (
          <option key={k} value={k}>
            {v.label}
          </option>
        ))}
      </Select>
      <Select aria-label="Prüfer/in" value={value.inspectorId} onChange={(e) => set({ inspectorId: e.target.value })}>
        <option value="">Alle Prüfer</option>
        {members.data?.members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.name}
          </option>
        ))}
      </Select>
      <Select aria-label="Art der Prüfung" value={value.kind} onChange={(e) => set({ kind: e.target.value })}>
        <option value="">Alle Arten der Prüfung</option>
        {kinds.map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </Select>
    </div>
  );
}

/** Lesbare Beschreibung der aktiven Filter (für den Kopf des PDF-Berichts). */
export function describeFilter(f: InspectionFilter, names: { property?: string; building?: string; inspector?: string; category?: string; kind?: string }): [string, string][] {
  const out: [string, string][] = [];
  const r = periodRange(f);
  const day = (t?: number) => (t ? new Date(t).toLocaleDateString('de-DE') : '…');
  if (f.period) out.push(['Zeitraum', f.period === 'custom' ? `${day(r.from)} – ${day(r.to)}` : (PERIODS.find(([k]) => k === f.period)?.[1] ?? '')]);
  if (names.property) out.push(['Objekt', names.property]);
  if (names.building) out.push(['Gebäude', names.building]);
  if (names.category) out.push(['Elementart', names.category]);
  if (f.result) out.push(['Ergebnis', RESULT_META[f.result as keyof typeof RESULT_META]?.label ?? f.result]);
  if (names.inspector) out.push(['Prüfer/in', names.inspector]);
  if (names.kind) out.push(['Art der Prüfung', names.kind]);
  if (f.q.trim()) out.push(['Suche', f.q.trim()]);
  return out;
}

// Autopilot im Browser: Monatsberichte (PDF entsteht hier, nicht im Worker) erzeugen und archivieren.
import { api, type Defect, type Me, type PropertyDetail, queryClient } from './api';

export interface MonthlyStatus {
  mode: 'off' | 'suggest' | 'auto';
  period: string;
  label: string;
  properties: number;
  due: boolean;
}

interface Claim {
  logId: string;
  period: string;
  label: string;
  properties: { id: string; name: string }[];
}

const slug = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/**
 * Reserviert den Berichtsmonat, erzeugt je Objekt den Objektbericht und legt ihn im Archiv ab.
 * Wirft bei 409, wenn eine andere Person (oder ein anderer Tab) schneller war.
 */
export async function runMonthlyReports(me: Me, onProgress?: (done: number, total: number) => void): Promise<{ archived: number; label: string }> {
  const claim = await api<Claim>('/automation/monthly-report/claim', { method: 'POST', body: {} });
  const ids: string[] = [];
  try {
    const [defects, r] = await Promise.all([api<Defect[]>('/defects?status=open'), import('./pdf/reports')]);
    const brand = await r.loadBrand(me);
    onProgress?.(0, claim.properties.length);
    for (const [i, p] of claim.properties.entries()) {
      const detail = await api<PropertyDetail>(`/properties/${p.id}`);
      const bytes = await r.propertyPdf(
        detail,
        defects.filter((d) => d.propertyId === p.id),
        brand,
      );
      const qs = new URLSearchParams({ kind: 'property', title: `Monatsbericht ${p.name} · ${claim.label}`, fileName: `Monatsbericht_${slug(p.name)}_${claim.period}.pdf`, propertyId: p.id });
      const res = await api<{ id: string }>(`/reports?${qs}`, { method: 'POST', raw: new Blob([bytes as BlobPart], { type: 'application/pdf' }), type: 'application/pdf' });
      ids.push(res.id);
      onProgress?.(i + 1, claim.properties.length);
    }
  } finally {
    // Auch bei Abbruch abschließen: bereits archivierte Berichte bleiben nachvollziehbar und lassen sich rückgängig machen
    await api(`/automation/monthly-report/${claim.logId}/complete`, { body: { reportIds: ids } }).catch(() => undefined);
    queryClient.invalidateQueries({ queryKey: ['reports'] });
    queryClient.invalidateQueries({ queryKey: ['automation'] });
    queryClient.invalidateQueries({ queryKey: ['smart'] });
  }
  return { archived: ids.length, label: claim.label };
}

let started = false;
/** Stufe „Automatisch“: beim ersten Öffnen der App durch eine Admin-Person im Monat im Hintergrund erzeugen. */
export async function autoMonthlyReports(me: Me) {
  if (started || !['owner', 'admin'].includes(me.user.role) || me.user.scoped || !navigator.onLine) return;
  started = true;
  try {
    const s = await api<MonthlyStatus>('/automation/monthly-report');
    if (s.mode === 'auto' && s.due) await runMonthlyReports(me);
  } catch {
    // still: beim nächsten Öffnen erneut versuchen (eine liegengebliebene Reservierung läuft nach 30 Minuten ab)
  }
}

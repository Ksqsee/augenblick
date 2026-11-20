// Sammelmappe erzeugen (Plan v7, Paket X): ein PDF aus allen abgeschlossenen Protokollen eines Objekts für einen
// Rundgang-Tag oder Zeitraum. Erreichbar auf der Objektseite (⋯ → Sammelmappe), unter Berichte und direkt nach
// „Alle unterschreiben“. Die Erzeugung läuft Protokoll für Protokoll mit Fortschritt; Schließen bricht ab.
import { useQuery } from '@tanstack/react-query';
import { BookCopy } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, archiveReport, type InspectionRow, useMe, useProperties } from '../api';
import { categoryLabel } from '../format';
import type { MappeProgress, MappeResult } from '../pdf/nacharbeit';
import { Button, ErrorBox, Field, Input, Modal, Notice, Segmented, Select, useToast } from './ui';

const dayKey = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const dayStart = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d).getTime();
};
const dayEnd = (ymd: string) => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d + 1).getTime() - 1;
};
const n2 = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

const STAGE: Record<MappeProgress['stage'], string> = { load: 'Prüfungen laden', render: 'Protokolle erzeugen', build: 'Mappe zusammenstellen' };

/** Knopf, der den Dialog öffnet. */
export function MappeButton({ propertyId, variant = 'secondary', label = 'Sammelmappe' }: { propertyId?: string; variant?: 'secondary' | 'ghost' | 'primary'; label?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant={variant} icon={<BookCopy />} onClick={() => setOpen(true)}>
        {label}
      </Button>
      {open && <MappeDialog propertyId={propertyId} onClose={() => setOpen(false)} />}
    </>
  );
}

/**
 * Dialog: Objekt (falls nicht vorgegeben), Rundgang-Tag oder Zeitraum, optional Elementart – oder feste Prüfungen
 * (`ids`, z. B. gerade unterschrieben). Zeigt vorab, wie viele Protokolle hineinkommen.
 */
export function MappeDialog({ propertyId: fixed, ids, day: initialDay, onClose }: { propertyId?: string; ids?: string[]; /** vorgewählter Rundgang-Tag (JJJJ-MM-TT), z. B. aus dem Reiter „Begehung“ */ day?: string; onClose: () => void }) {
  const { data: me } = useMe();
  const toast = useToast();
  const props = useProperties();
  const [propertyId, setPropertyId] = useState(fixed ?? '');
  const pid = propertyId || props.data?.[0]?.id || '';
  const list = useQuery({
    queryKey: ['inspections', 'mappe', pid],
    queryFn: () => api<InspectionRow[]>(`/inspections?status=submitted&propertyId=${encodeURIComponent(pid)}`),
    enabled: !!pid && !ids,
  });
  const rows = list.data ?? [];
  const days = useMemo(() => [...new Set(rows.map((r) => dayKey(r.inspectedAt ?? r.createdAt)))], [rows]);
  const [mode, setMode] = useState<'day' | 'range'>('day');
  const [day, setDay] = useState(initialDay ?? '');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [category, setCategory] = useState('');
  // Vorgabe: der letzte Tag mit Prüfungen (ein Rundgang)
  useEffect(() => {
    if (!days.length) return;
    if (!day || !days.includes(day)) setDay(days[0]);
    if (!from) setFrom(days[days.length - 1]);
    if (!to) setTo(days[0]);
  }, [days]);
  const range = mode === 'day' ? (day ? { from: dayStart(day), to: dayEnd(day) } : null) : from && to ? { from: dayStart(from), to: dayEnd(to) } : null;
  const picked = ids
    ? ids.length
    : rows.filter((r) => {
        const t = r.inspectedAt ?? r.createdAt;
        return range && t >= range.from && t <= range.to && (!category || r.category === category);
      }).length;
  const cats = [...new Set(rows.map((r) => r.category))];

  const [progress, setProgress] = useState<MappeProgress | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [done, setDone] = useState<MappeResult | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const close = () => {
    abort.current?.abort();
    onClose();
  };

  const run = async () => {
    if (!me || !pid || (!ids && !range)) return;
    setError(null);
    setDone(null);
    const ctl = new AbortController();
    abort.current = ctl;
    setProgress({ stage: 'load', done: 0, total: picked });
    try {
      const r = await import('../pdf/nacharbeit');
      const { download } = await import('../pdf/reports');
      const res = await r.buildMappe(ids ? { propertyId: pid, ids } : { propertyId: pid, ...range!, category: category || undefined }, me, setProgress, ctl.signal);
      download(res.bytes, res.fileName);
      setDone(res);
      if (await archiveReport(me, res.bytes, { kind: 'mappe', title: res.title, fileName: res.fileName, propertyId: pid }).catch(() => false)) toast('Sammelmappe im Berichtsarchiv gespeichert');
    } catch (e) {
      if (!(e instanceof DOMException && e.name === 'AbortError')) setError(e);
    } finally {
      setProgress(null);
      abort.current = null;
    }
  };

  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <Modal
      title="Sammelmappe"
      description="Alle abgeschlossenen Protokolle in einem PDF: Deckblatt, Inhaltsliste, erst ohne Mangel, dann nach gleichem Mangel gruppiert."
      onClose={close}
      footer={
        <>
          <Button variant="secondary" onClick={close}>
            {done ? 'Fertig' : progress ? 'Abbrechen' : 'Schließen'}
          </Button>
          {!done && (
            <Button icon={<BookCopy />} loading={!!progress} disabled={!picked || !!progress} onClick={() => void run()}>
              {picked ? `Mappe mit ${n2(picked, 'Protokoll', 'Protokollen')} erzeugen` : 'Mappe erzeugen'}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4" data-mappe>
        {error != null && <ErrorBox error={error} />}
        {!fixed && !ids && (
          <Field label="Objekt">
            {(id) => (
              <Select id={id} value={pid} onChange={(e) => setPropertyId(e.target.value)}>
                {props.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        {ids ? (
          <p className="text-body text-ink-2">{n2(ids.length, 'gerade unterschriebene Prüfung', 'gerade unterschriebene Prüfungen')}.</p>
        ) : list.isLoading ? (
          <p className="text-body text-ink-3">Prüfungen werden gezählt …</p>
        ) : !rows.length ? (
          <p className="text-body text-ink-2">In diesem Objekt gibt es noch keine abgeschlossene Prüfung.</p>
        ) : (
          <>
            <Segmented
              className="self-start"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'day', label: 'Rundgang-Tag' },
                { value: 'range', label: 'Zeitraum' },
              ]}
            />
            {mode === 'day' ? (
              <Field label="Tag" hint={`${n2(days.length, 'Tag', 'Tage')} mit Prüfungen`}>
                {(id) => (
                  <Select id={id} value={day} onChange={(e) => setDay(e.target.value)}>
                    {days.map((k) => (
                      <option key={k} value={k}>
                        {new Date(dayStart(k)).toLocaleDateString('de-DE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' })} ·{' '}
                        {rows.filter((r) => dayKey(r.inspectedAt ?? r.createdAt) === k).length}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Von">{(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
                <Field label="Bis">{(id) => <Input id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
              </div>
            )}
            {cats.length > 1 && (
              <Field label="Elementart" optional>
                {(id) => (
                  <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                    <option value="">Alle Arten</option>
                    {cats.map((c) => (
                      <option key={c} value={c}>
                        {categoryLabel(c)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <p className="text-meta text-ink-3 tabular-nums" aria-live="polite">
              {picked ? `${n2(picked, 'Protokoll', 'Protokolle')} im gewählten Zeitraum` : 'Keine Prüfung im gewählten Zeitraum'}
            </p>
          </>
        )}
        {progress && (
          <div className="flex flex-col gap-1.5" role="status" aria-live="polite">
            <div className="flex items-baseline justify-between gap-3 text-meta">
              <span className="text-ink-2">{STAGE[progress.stage]}</span>
              <span className="text-ink-3 tabular-nums" data-mappe-progress>
                {progress.stage === 'build' ? '' : `${progress.done} / ${progress.total}`}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-sunken">
              <div className="h-full rounded-full bg-ink transition-[width]" style={{ width: `${progress.stage === 'build' ? 100 : pct}%` }} />
            </div>
          </div>
        )}
        {done && (
          <Notice tone="ok" title="Sammelmappe erstellt">
            <span data-mappe-done>
              {n2(done.counts.total, 'Protokoll', 'Protokolle')} auf {done.pages} Seiten: {done.counts.clean} ohne Mangel, {done.counts.withDefects} mit Mangel
              {done.counts.notInspectable ? `, ${done.counts.notInspectable} nicht prüfbar` : ''}.
            </span>
            {done.missingProof > 0 && (
              <span className="mt-1 block text-warn">
                {n2(done.missingProof, 'Protokoll', 'Protokolle')} ohne gültigen Befähigungsnachweis – steht auf dem Deckblatt.
              </span>
            )}
          </Notice>
        )}
      </div>
    </Modal>
  );
}

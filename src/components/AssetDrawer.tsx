import { ArrowUpRight, ClipboardCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Asset, useAction, useMe } from '../api';
import { attributeRows } from './forms';
import { CategoryIcon } from './CategoryIcon';
import { dueInfo, DuePhrase, placeText } from './objects/status';
import { Button, Drawer, ErrorBox, PropertyList, ResultBadge, StatusText } from './ui';
import { schedulesFor } from '../categories';
import { categoryLabel, fmtDate } from '../format';

export function useStartInspection() {
  const navigate = useNavigate();
  return useAction(
    /** `taskId`: aus einer Aufgabe gestartet – Mängelbehebung wird zur Nachprüfung, Prüfauftrag bleibt Regelprüfung */
    (v: string | { assetId: string; schedule?: string; taskId?: string }) => {
      const { assetId, schedule, taskId } = typeof v === 'string' ? { assetId: v, schedule: undefined, taskId: undefined } : v;
      return api<{ id: string }>(`/assets/${assetId}/inspections`, { method: 'POST', body: { ...(schedule ? { schedule } : {}), ...(taskId ? { taskId } : {}) } });
    },
    (r) => navigate(`/pruefung/${r.id}`),
  );
}

/** Schnellansicht eines Elements rechts (Listen, Objekt, Grundriss) – Prüfen ohne Seitenwechsel. v3: keine Karten, Abschnitte durch Haarlinien. */
export function AssetDrawer({ asset, onClose, children }: { asset: Asset; onClose: () => void; children?: React.ReactNode }) {
  const start = useStartInspection();
  const { data: me } = useMe();
  const canInspect = me?.user.role !== 'viewer';
  const d = dueInfo(asset);
  const attrs = attributeRows(asset.category, asset.attributes).filter(([, v]) => v !== '–');
  return (
    <Drawer
      title={
        <span className="flex items-center gap-2.5">
          <CategoryIcon category={asset.category} size="sm" />
          {asset.code}
        </span>
      }
      subtitle={`${categoryLabel(asset.category)} · ${placeText(asset)}`}
      onClose={onClose}
      footer={
        <>
          <Link to={`/elemente/${asset.id}`} className="flex-1">
            <Button variant="secondary" className="w-full" icon={<ArrowUpRight className="size-4" />}>
              Details
            </Button>
          </Link>
          {canInspect && (
            <Button className="flex-1" icon={<ClipboardCheck className="size-4" />} loading={start.isPending} onClick={() => start.mutate(asset.id)}>
              Prüfen
            </Button>
          )}
        </>
      }
    >
      {start.error && <ErrorBox error={start.error} className="mb-4" />}
      <p className="mb-4">
        <StatusText tone={d.tone}>{d.detail}</StatusText>
      </p>
      <PropertyList
          className="border-t border-line pt-4"
          items={[
            { label: 'Nächste Prüfung', value: asset.nextDueAt ? fmtDate(asset.nextDueAt) : null },
            { label: 'Letzte Prüfung', value: asset.lastInspectedAt ? fmtDate(asset.lastInspectedAt) : null },
            { label: 'Ergebnis', value: asset.lastResult ? <ResultBadge result={asset.lastResult} /> : null },
            { label: 'Offene Mängel', value: asset.openDefects || null },
            { label: 'Objekt', value: asset.propertyName },
            { label: 'Gebäude', value: asset.buildingName },
            { label: 'Hersteller', value: asset.manufacturer },
            { label: 'Typ', value: asset.model },
          ]}
        />
      {attrs.length > 0 && (
        <>
          <p className="mt-6 mb-3 text-meta font-medium text-ink-3">Stammdaten</p>
          <PropertyList className="border-t border-line pt-4" items={attrs.map(([label, value]) => ({ label, value }))} />
        </>
      )}
      <ScheduleList asset={asset} canInspect={!!canInspect} onStart={(schedule) => start.mutate({ assetId: asset.id, schedule })} />
      {children}
    </Drawer>
  );
}

/** Aktive Prüfarten mit Termin; bei mehreren direkt startbar. */
function ScheduleList({ asset, canInspect, onStart }: { asset: Asset; canInspect: boolean; onStart: (schedule: string) => void }) {
  const active = schedulesFor(asset.category).filter((s) => s.key === 'main' || asset.schedules?.[s.key]?.enabled);
  if (active.length < 2) return null;
  return (
    <>
      <p className="mt-6 mb-1 text-meta font-medium text-ink-3">Prüfarten</p>
      <ul className="divide-y divide-line border-y border-line">
        {active.map((s) => {
          const st = asset.schedules?.[s.key];
          return (
            <li key={s.key} className="flex min-h-14 items-center gap-3 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-body text-ink">{s.label}</span>
                <DuePhrase asset={{ nextDueAt: st?.nextDueAt ?? null, lastResult: st?.lastResult ?? null }} />
              </span>
              {canInspect && (
                <Button size="sm" variant="secondary" onClick={() => onStart(s.key)}>
                  Prüfen
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

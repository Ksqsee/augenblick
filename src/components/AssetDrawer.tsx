import { ArrowUpRight, ClipboardCheck } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Asset, useAction, useMe } from '../api';
import { attributeRows } from './forms';
import { CategoryIcon } from './CategoryIcon';
import { AssetStatusBadge, dueInfo, placeText } from './objects/status';
import { Button, Card, Drawer, ErrorBox, PropertyList, ResultBadge, toneText } from './ui';
import { schedulesFor } from '../categories';
import { categoryLabel, fmtDate } from '../format';

export function useStartInspection() {
  const navigate = useNavigate();
  return useAction(
    (v: string | { assetId: string; schedule?: string }) => {
      const { assetId, schedule } = typeof v === 'string' ? { assetId: v, schedule: undefined } : v;
      return api<{ id: string }>(`/assets/${assetId}/inspections`, { method: 'POST', body: schedule ? { schedule } : {} });
    },
    (r) => navigate(`/pruefung/${r.id}`),
  );
}

/** Schnellansicht eines Elements rechts (Listen, Objekt, Grundriss) – Prüfen ohne Seitenwechsel. */
export function AssetDrawer({ asset, onClose, children }: { asset: Asset; onClose: () => void; children?: React.ReactNode }) {
  const start = useStartInspection();
  const { data: me } = useMe();
  const canInspect = me?.user.role !== 'viewer';
  const d = dueInfo(asset);
  const attrs = attributeRows(asset.category, asset.attributes).filter(([, v]) => v !== '–');
  return (
    <Drawer
      title={
        <span className="flex items-center gap-3">
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
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <AssetStatusBadge asset={asset} />
        <span className={`text-meta ${d.tone === 'bad' || d.tone === 'warn' ? toneText[d.tone] : 'text-ink-3'}`}>{d.detail}</span>
      </div>
      <Card className="p-4">
        <PropertyList
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
      </Card>
      {attrs.length > 0 && (
        <>
          <p className="mt-5 mb-2 text-meta font-semibold text-ink-2">Stammdaten</p>
          <Card className="p-4">
            <PropertyList items={attrs.map(([label, value]) => ({ label, value }))} />
          </Card>
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
      <p className="mt-5 mb-2 text-meta font-semibold text-ink-2">Prüfarten</p>
      <Card className="divide-y divide-line">
        {active.map((s) => {
          const st = asset.schedules?.[s.key];
          return (
            <div key={s.key} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-body font-medium">{s.label}</span>
                <span className="block text-meta text-ink-3">{dueInfo({ nextDueAt: st?.nextDueAt ?? null, lastResult: st?.lastResult ?? null }).detail}</span>
              </span>
              <AssetStatusBadge asset={{ nextDueAt: st?.nextDueAt ?? null, lastResult: st?.lastResult ?? null }} />
              {canInspect && (
                <Button size="sm" variant="secondary" onClick={() => onStart(s.key)}>
                  Prüfen
                </Button>
              )}
            </div>
          );
        })}
      </Card>
    </>
  );
}

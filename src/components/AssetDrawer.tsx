import { ClipboardCheck, ExternalLink } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Asset, useAction, useMe } from '../api';
import { attributeRows } from './forms';
import { DueBadge } from './AssetList';
import { CategoryIcon } from './CategoryIcon';
import { Button, Card, Drawer, ErrorBox, KeyValue } from './ui';
import { schedulesFor } from '../categories';
import { categoryLabel, fmtDate, RESULT_META } from '../format';

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

export function AssetDrawer({ asset, onClose, children }: { asset: Asset; onClose: () => void; children?: React.ReactNode }) {
  const start = useStartInspection();
  const { data: me } = useMe();
  const canInspect = me?.user.role !== 'viewer';
  return (
    <Drawer
      title={
        <span className="flex items-center gap-3">
          <CategoryIcon category={asset.category} size="sm" />
          {asset.code}
        </span>
      }
      subtitle={`${categoryLabel(asset.category)} · ${asset.propertyName}`}
      onClose={onClose}
      footer={
        <>
          <Link to={`/elemente/${asset.id}`} className="flex-1">
            <Button variant="secondary" className="w-full" icon={<ExternalLink className="size-4" />}>
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
      {start.error && <ErrorBox error={start.error} />}
      <div className="mb-4 flex flex-wrap gap-2">
        <DueBadge asset={asset} />
        {asset.lastResult && <span className="text-xs text-ink-3">Letztes Ergebnis: {RESULT_META[asset.lastResult].label}</span>}
      </div>
      <Card className="mb-4 px-4">
        <KeyValue
          items={[
            ['Objekt', asset.propertyName],
            ['Gebäude', asset.buildingName],
            ['Standort', asset.location],
            ['Etage', asset.floor],
            ['Hersteller', asset.manufacturer],
            ['Typ', asset.model],
            ['Letzte Prüfung', fmtDate(asset.lastInspectedAt)],
            ['Nächste Prüfung', fmtDate(asset.nextDueAt)],
          ]}
        />
      </Card>
      <p className="mb-2 text-[13px] font-semibold text-ink-2">Stammdaten</p>
      <Card className="px-4">
        <KeyValue items={attributeRows(asset.category, asset.attributes)} />
      </Card>
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
      <p className="mt-4 mb-2 text-[13px] font-semibold text-ink-2">Prüfarten</p>
      <Card className="divide-y divide-line">
        {active.map((s) => {
          const st = asset.schedules?.[s.key];
          return (
            <div key={s.key} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">{s.label}</span>
                <span className="block text-xs text-ink-3">nächste: {fmtDate(st?.nextDueAt ?? null)}</span>
              </span>
              <DueBadge asset={{ nextDueAt: st?.nextDueAt ?? null, lastResult: st?.lastResult ?? null }} />
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

import { Building2, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useMe, useProperties } from '../api';
import { PropertyForm } from '../components/forms';
import { Badge, Button, Card, Empty, ErrorBox, Input, PageHeader, Spinner } from '../components/ui';
import { defectsLabel, fmtDate } from '../format';

export function PropertiesPage() {
  const { data, isLoading, error } = useProperties();
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const navigate = useNavigate();
  const creating = params.get('neu') === '1';
  const canEdit = me && ['owner', 'admin'].includes(me.user.role);
  const rows = (data ?? []).filter((p) => (p.name + p.address + p.contactName).toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader
        title="Objekte"
        subtitle="Liegenschaften mit ihren Gebäuden und Elementen"
        actions={
          canEdit && (
            <Button icon={<Plus className="size-4" />} onClick={() => setParams({ neu: '1' })}>
              Neues Objekt
            </Button>
          )
        }
      />
      {creating && <PropertyForm onClose={() => setParams({})} />}
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
        <Input placeholder="Objekte durchsuchen" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : rows.length === 0 ? (
        <Card>
          <Empty
            icon={<Building2 className="size-5" />}
            title={q ? 'Kein Treffer' : 'Noch keine Objekte'}
            text={q ? undefined : 'Lege ein Objekt an, um Gebäude und Elemente zu erfassen.'}
            action={
              !q &&
              canEdit && (
                <Button icon={<Plus className="size-4" />} onClick={() => setParams({ neu: '1' })}>
                  Objekt anlegen
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead className="hidden border-b border-line bg-sunken/50 text-left text-xs text-ink-3 md:table-header-group">
              <tr>
                <th className="px-5 py-2.5 font-medium">Objekt</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 text-right font-medium">Elemente</th>
                <th className="px-3 py-2.5 text-right font-medium">Mängel</th>
                <th className="px-3 py-2.5 font-medium">Letzte Prüfung</th>
                <th className="px-5 py-2.5 font-medium">Nächste fällig</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((p) => {
                const overdue = p.overdue ?? 0;
                const soon = p.soon ?? 0;
                const never = p.never ?? 0;
                return (
                  <tr key={p.id} onClick={() => navigate(`/objekte/${p.id}`)} className="cursor-pointer hover:bg-sunken/60">
                    <td className="px-5 py-3.5">
                      <Link to={`/objekte/${p.id}`} className="font-medium" onClick={(e) => e.stopPropagation()}>
                        {p.name}
                      </Link>
                      <p className="text-xs text-ink-3">{p.address.split('\n').join(', ') || '–'}</p>
                      <div className="mt-2 flex flex-wrap gap-1.5 md:hidden">
                        <StatusBadges overdue={overdue} soon={soon} never={never} defects={p.openDefects} assets={p.assets} />
                      </div>
                    </td>
                    <td className="hidden px-3 py-3.5 md:table-cell">
                      <div className="flex flex-wrap gap-1.5">
                        <StatusBadges overdue={overdue} soon={soon} never={never} defects={0} assets={p.assets} />
                      </div>
                    </td>
                    <td className="hidden px-3 py-3.5 text-right tabular-nums md:table-cell">{p.assets}</td>
                    <td className="hidden px-3 py-3.5 text-right tabular-nums md:table-cell">
                      {p.openDefects ? <span className="font-medium text-warn">{p.openDefects}</span> : <span className="text-ink-3">0</span>}
                    </td>
                    <td className="hidden px-3 py-3.5 text-ink-2 md:table-cell">{fmtDate(p.lastInspectedAt)}</td>
                    <td className="hidden px-5 py-3.5 text-ink-2 md:table-cell">{fmtDate(p.nextDueAt)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  );
}

function StatusBadges({ overdue, soon, never, defects, assets }: { overdue: number; soon: number; never: number; defects: number; assets: number }) {
  const out = [];
  if (overdue) out.push(<Badge key="o" tone="bad" dot>{overdue} überfällig</Badge>);
  if (soon) out.push(<Badge key="s" tone="warn" dot>{soon} bald fällig</Badge>);
  if (defects) out.push(<Badge key="d" tone="warn">{defectsLabel(defects)}</Badge>);
  if (never) out.push(<Badge key="n" tone="info" dot>{never} ungeprüft</Badge>);
  if (!out.length) out.push(assets ? <Badge key="ok" tone="ok" dot>Aktuell</Badge> : <Badge key="e">Leer</Badge>);
  return <>{out}</>;
}

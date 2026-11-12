// Objekte: Liste der Liegenschaften mit Prüfstatus. Vorlage „Liste“ (docs/design.md 5.1).
import { Building2, Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type PropertyRow, useMe, useProperties } from '../api';
import { PropertyForm } from '../components/forms';
import { StatusBar } from '../components/objects/status';
import { Badge, Button, Chip, type Column, DataTable, Empty, ErrorBox, FilterBar, PageHeader, SkeletonList } from '../components/ui';
import { fmtDate } from '../format';

type Filter = 'alle' | 'ueberfaellig' | 'maengel';

const counts = (p: PropertyRow) => {
  const overdue = p.overdue ?? 0;
  const soon = p.soon ?? 0;
  const never = p.never ?? 0;
  return { overdue, soon, never, ok: Math.max(0, p.assets - overdue - soon - never) };
};

/** Dringendster Zustand eines Objekts als ein Badge. */
function SummaryBadge({ p }: { p: PropertyRow }) {
  const c = counts(p);
  if (!p.assets) return <Badge>Leer</Badge>;
  if (c.overdue)
    return (
      <Badge tone="bad" dot>
        {c.overdue} überfällig
      </Badge>
    );
  if (c.soon)
    return (
      <Badge tone="warn" dot>
        {c.soon} bald fällig
      </Badge>
    );
  if (c.never)
    return (
      <Badge tone="info" dot>
        {c.never} ungeprüft
      </Badge>
    );
  return (
    <Badge tone="ok" dot>
      Aktuell
    </Badge>
  );
}

const columns: Column<PropertyRow>[] = [
  { key: 'name', header: 'Objekt', cell: (p) => p.name },
  { key: 'address', header: 'Adresse', cell: (p) => <span className="text-ink-3">{p.address.split('\n').join(', ') || '–'}</span>, className: 'max-w-64 truncate' },
  { key: 'bar', header: 'Prüfstatus', cell: (p) => <StatusBar counts={counts(p)} className="w-28" />, mobile: 'hidden' },
  { key: 'assets', header: 'Elemente', align: 'right', cell: (p) => (p.assets ? p.assets : <span className="text-ink-4">0</span>), mobile: 'hidden' },
  {
    key: 'defects',
    header: 'Mängel',
    align: 'right',
    cell: (p) => (p.openDefects ? <span className="font-medium text-warn">{p.openDefects}</span> : <span className="text-ink-4">0</span>),
    mobile: 'hidden',
  },
  { key: 'next', header: 'Nächste Prüfung', className: 'whitespace-nowrap', cell: (p) => <span className={p.nextDueAt && p.nextDueAt < Date.now() ? 'text-bad' : undefined}>{fmtDate(p.nextDueAt)}</span>, mobile: 'hidden' },
  { key: 'status', header: 'Status', cell: (p) => <SummaryBadge p={p} /> },
];

export function PropertiesPage() {
  const { data, isLoading, error, refetch } = useProperties();
  const { data: me } = useMe();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('alle');
  const creating = params.get('neu') === '1';
  const canEdit = me && ['owner', 'admin'].includes(me.user.role);
  const all = data ?? [];
  const byFilter = (p: PropertyRow) => (filter === 'ueberfaellig' ? (p.overdue ?? 0) > 0 : filter === 'maengel' ? p.openDefects > 0 : true);
  const rows = all
    .filter((p) => (p.name + p.address + p.contactName).toLowerCase().includes(q.trim().toLowerCase()))
    .filter(byFilter);
  const filtered = !!q.trim() || filter !== 'alle';
  const newButton = (label: string) =>
    canEdit && (
      <Button icon={<Plus className="size-4" />} onClick={() => setParams({ neu: '1' })}>
        {label}
      </Button>
    );

  return (
    <>
      <PageHeader title="Objekte" subtitle="Liegenschaften mit ihren Gebäuden und Elementen" actions={newButton('Neues Objekt')} />
      {creating && <PropertyForm onClose={() => setParams({})} />}

      {all.length > 0 && (
        <FilterBar search={{ value: q, onChange: setQ, placeholder: 'Name, Adresse, Ansprechperson' }}>
          <Chip active={filter === 'alle'} onClick={() => setFilter('alle')} count={all.length}>
            Alle
          </Chip>
          <Chip active={filter === 'ueberfaellig'} onClick={() => setFilter(filter === 'ueberfaellig' ? 'alle' : 'ueberfaellig')} count={all.filter((p) => (p.overdue ?? 0) > 0).length}>
            Mit Überfälligen
          </Chip>
          <Chip active={filter === 'maengel'} onClick={() => setFilter(filter === 'maengel' ? 'alle' : 'maengel')} count={all.filter((p) => p.openDefects > 0).length}>
            Mit Mängeln
          </Chip>
        </FilterBar>
      )}

      {isLoading ? (
        <SkeletonList rows={4} />
      ) : error ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(p) => p.id}
          rowTo={(p) => `/objekte/${p.id}`}
          empty={
            filtered ? (
              <Empty
                compact
                title="Keine Treffer"
                text="Kein Objekt passt zu Suche und Filter."
                action={
                  <Button
                    variant="secondary"
                    onClick={() => {
                      setQ('');
                      setFilter('alle');
                    }}
                  >
                    Filter zurücksetzen
                  </Button>
                }
              />
            ) : (
              <Empty icon={<Building2 />} title="Noch keine Objekte" text="Lege ein Objekt an, um Gebäude und Elemente zu erfassen." action={newButton('Objekt anlegen')} />
            )
          }
        />
      )}
    </>
  );
}

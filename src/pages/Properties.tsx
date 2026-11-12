// Objekte: Liste der Liegenschaften mit Prüfstatus. Vorlage „Liste“ (docs/design.md 5.2):
// Kopf · Filter auf dem Grund · eine Surface mit einer Section (Tabelle, Handy: Zeilen). Ein Statuswort je Objekt.
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type PropertyRow, useMe, useProperties } from '../api';
import { PropertyForm } from '../components/forms';
import { ObjectViews } from '../components/objects/Views';
import { PlainTable } from '../components/objects/PlainTable';
import { summaryWord } from '../components/objects/status';
import { Button, Chip, type Column, Empty, ErrorBox, FilterBar, PageHeader, Section, SkeletonList, StatusText, Surface } from '../components/ui';
import { defectsLabel, fmtDate } from '../format';

type Filter = 'alle' | 'ueberfaellig' | 'maengel';

const counts = (p: PropertyRow) => {
  const overdue = p.overdue ?? 0;
  const soon = p.soon ?? 0;
  const never = p.never ?? 0;
  return { overdue, soon, never, ok: Math.max(0, p.assets - overdue - soon - never) };
};

/** Dringendster Zustand eines Objekts als ein Wort mit Punkt. */
function Summary({ p }: { p: PropertyRow }) {
  const s = summaryWord(counts(p), p.assets);
  return <StatusText tone={s.tone}>{s.label}</StatusText>;
}

const columns: Column<PropertyRow>[] = [
  { key: 'name', header: 'Objekt', cell: (p) => p.name },
  { key: 'address', header: 'Adresse', cell: (p) => <span className="text-ink-3">{p.address.split('\n').join(', ') || '–'}</span>, className: 'max-w-64 truncate' },
  { key: 'assets', header: 'Elemente', align: 'right', cell: (p) => (p.assets ? p.assets : <span className="text-ink-4">0</span>), mobile: 'hidden' },
  { key: 'defects', header: 'Offene Mängel', align: 'right', cell: (p) => (p.openDefects ? p.openDefects : <span className="text-ink-4">0</span>), mobile: 'hidden' },
  { key: 'next', header: 'Nächste Prüfung', className: 'whitespace-nowrap', cell: (p) => (p.nextDueAt ? fmtDate(p.nextDueAt) : <span className="text-ink-4">–</span>), mobile: 'hidden' },
  { key: 'status', header: 'Status', className: 'w-40', cell: (p) => <Summary p={p} /> },
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
  const rows = all.filter((p) => (p.name + p.address + p.contactName).toLowerCase().includes(q.trim().toLowerCase())).filter(byFilter);
  const filtered = !!q.trim() || filter !== 'alle';
  const reset = () => {
    setQ('');
    setFilter('alle');
  };
  const newButton = (label: string) =>
    canEdit && (
      <Button icon={<Plus className="size-4" />} onClick={() => setParams({ neu: '1' })}>
        {label}
      </Button>
    );
  const assets = all.reduce((s, p) => s + p.assets, 0);
  const defects = all.reduce((s, p) => s + p.openDefects, 0);

  return (
    <>
      <PageHeader title="Objekte" subtitle="Liegenschaften mit ihren Gebäuden und Elementen" actions={newButton('Neues Objekt')} />
      <ObjectViews current="objekte" />
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

      {error ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : (
        <Surface>
          {isLoading ? (
            <Section>
              <SkeletonList rows={4} />
            </Section>
          ) : !rows.length ? (
            <Section>
              {filtered ? (
                <Empty
                  compact
                  title="Keine Treffer"
                  text="Kein Objekt passt zu Suche und Filter."
                  action={
                    <Button variant="ghost" onClick={reset}>
                      Filter zurücksetzen
                    </Button>
                  }
                />
              ) : (
                <Empty title="Noch keine Objekte" text="Lege ein Objekt an, um Gebäude und Elemente zu erfassen." action={newButton('Objekt anlegen')} />
              )}
            </Section>
          ) : (
            <Section
              flush
              title={rows.length === 1 ? '1 Objekt' : `${rows.length} Objekte`}
              action={
                filtered ? (
                  <button type="button" onClick={reset} className="text-meta font-medium text-ink-2 hover:text-ink">
                    Filter zurücksetzen
                  </button>
                ) : (
                  <span className="text-meta text-ink-3">
                    {assets} Elemente{defects > 0 ? ` · ${defectsLabel(defects)} offen` : ''}
                  </span>
                )
              }
            >
              <PlainTable columns={columns} rows={rows} rowKey={(p) => p.id} rowTo={(p) => `/objekte/${p.id}`} aria-label="Objekte" />
            </Section>
          )}
        </Surface>
      )}
    </>
  );
}

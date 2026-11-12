// Elemente: alle prüfpflichtigen Elemente, nach Dringlichkeit gruppiert. Vorlage „Liste“ (docs/design.md 5.2):
// Kopf · Filter auf dem Grund · eine Surface mit einer Section „N Elemente“. Ein Statuswort je Zeile.
// URL-Parameter: kategorie, status, objekt, q, neu, etikett
import { FileUp, Plus, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { type Asset, useAssets, useMe, useProperties } from '../api';
import { allCategories } from '../categories';
import { AssetDrawer } from '../components/AssetDrawer';
import { AssetList } from '../components/AssetList';
import { AssetForm } from '../components/forms';
import { FilterSelect } from '../components/objects/FilterSelect';
import { ObjectViews } from '../components/objects/Views';
import { Button, Chip, Empty, ErrorBox, FilterBar, Menu, PageHeader, Section, SkeletonList, Surface } from '../components/ui';

const DUE_FILTERS = [
  { value: 'overdue', label: 'Überfällig' },
  { value: 'soon', label: 'Bald fällig' },
  { value: 'never', label: 'Nie geprüft' },
  { value: 'defects', label: 'Mit Mängeln' },
];

export function AssetsPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(params.get('q') ?? '');
  const category = params.get('kategorie') ?? undefined;
  const due = params.get('status') ?? undefined;
  const propertyId = params.get('objekt') ?? undefined;
  const { data, isLoading, error, refetch } = useAssets({ q: debounced, category, due, propertyId });
  const { data: properties } = useProperties();
  const { data: me } = useMe();
  const [selected, setSelected] = useState<Asset | null>(null);
  const navigate = useNavigate();
  const canCreate = me?.user.role !== 'viewer' && me?.user.canCreate !== false;
  const creating = params.get('neu') === '1' && canCreate;

  const setParam = (k: string, v?: string) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (v) next.set(k, v);
        else next.delete(k);
        return next;
      },
      { replace: true },
    );

  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(q.trim());
      setParam('q', q.trim() || undefined);
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  const filtered = !!(debounced || category || due || propertyId);
  const reset = () => {
    setQ('');
    setDebounced('');
    setParams((p) => {
      const next = new URLSearchParams();
      if (p.get('neu')) next.set('neu', p.get('neu')!);
      return next;
    });
  };
  const newButton = (label: string) =>
    canCreate && (
      <Button icon={<Plus className="size-4" />} onClick={() => setParam('neu', '1')}>
        {label}
      </Button>
    );

  return (
    <>
      <PageHeader
        title="Elemente"
        subtitle="Alle prüfpflichtigen Elemente über alle Objekte"
        actions={
          <>
            <Menu
              label="Weitere Aktionen zu Elementen"
              items={[
                ...(canCreate ? [{ label: 'Aus Excel/CSV importieren', icon: <FileUp />, to: '/einstellungen/import' }] : []),
                { label: 'QR-Etiketten drucken', icon: <Printer />, to: '/druck/etiketten' },
              ]}
            />
            {newButton('Neues Element')}
          </>
        }
      />
      <ObjectViews current="elemente" />
      {creating && (
        <AssetForm defaultLabel={params.get('etikett') ?? undefined} onClose={(createdId) => (createdId ? navigate(`/elemente/${createdId}`) : setParam('neu'))} />
      )}
      {selected && <AssetDrawer asset={selected} onClose={() => setSelected(null)} />}

      <FilterBar
        search={{ value: q, onChange: setQ, placeholder: 'Code, Standort, Hersteller, Objekt …' }}
      >
        <FilterSelect className="w-32" label="Nach Art filtern" value={category ?? ''} onChange={(v) => setParam('kategorie', v || undefined)}>
          <option value="">Alle Arten</option>
          {allCategories().map((c) => (
            <option key={c.key} value={c.key}>
              {c.plural}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect className="w-36" label="Nach Objekt filtern" value={propertyId ?? ''} onChange={(v) => setParam('objekt', v || undefined)}>
          <option value="">Alle Objekte</option>
          {propertyId && !properties?.some((p) => p.id === propertyId) && <option value={propertyId}>Objekt</option>}
          {properties?.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </FilterSelect>
        <span className="mx-0.5 w-px shrink-0 self-stretch bg-line" aria-hidden />
        {DUE_FILTERS.map((f) => (
          <Chip key={f.value} active={due === f.value} onClick={() => setParam('status', due === f.value ? undefined : f.value)}>
            {f.label}
          </Chip>
        ))}
      </FilterBar>

      {error ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : (
        <Surface>
          {isLoading ? (
            <Section>
              <SkeletonList rows={8} />
            </Section>
          ) : !data?.length ? (
            <Section>
              {filtered ? (
                <Empty
                  title="Keine Treffer"
                  text="Kein Element passt zu Suche und Filter."
                  action={
                    <Button variant="ghost" onClick={reset}>
                      Filter zurücksetzen
                    </Button>
                  }
                />
              ) : (
                <Empty title="Noch keine Elemente" text="Lege dein erstes Element an – oder importiere eine Liste." action={newButton('Element anlegen')} />
              )}
            </Section>
          ) : (
            <Section
              flush
              title={data.length === 1 ? '1 Element' : `${data.length} Elemente`}
              action={
                filtered && (
                  <button type="button" onClick={reset} className="text-meta font-medium text-ink-2 hover:text-ink">
                    Filter zurücksetzen
                  </button>
                )
              }
            >
              <AssetList assets={data} onSelect={setSelected} grouped={!due || due === 'defects'} aria-label="Elemente" />
            </Section>
          )}
        </Surface>
      )}
    </>
  );
}

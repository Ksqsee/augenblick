import { Package, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CATEGORY_LIST } from '../../shared/catalog';
import { type Asset, useAssets, useMe } from '../api';
import { AssetDrawer } from '../components/AssetDrawer';
import { AssetList } from '../components/AssetList';
import { AssetForm } from '../components/forms';
import { Button, Card, Chip, Empty, ErrorBox, Input, PageHeader, Spinner } from '../components/ui';

const DUE_FILTERS = [
  { value: 'overdue', label: 'Überfällig' },
  { value: 'soon', label: 'Bald fällig' },
  { value: 'never', label: 'Nie geprüft' },
  { value: 'defects', label: 'Mit Mängeln' },
];

export function AssetsPage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const category = params.get('kategorie') ?? undefined;
  const due = params.get('status') ?? undefined;
  const { data, isLoading, error } = useAssets({ q: debounced, category, due });
  const { data: me } = useMe();
  const [selected, setSelected] = useState<Asset | null>(null);
  const navigate = useNavigate();
  const creating = params.get('neu') === '1';

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);

  const setParam = (k: string, v?: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Elemente"
        subtitle="Alle prüfpflichtigen Elemente über alle Objekte"
        actions={
          me?.user.role !== 'viewer' && (
            <Button icon={<Plus className="size-4" />} onClick={() => setParam('neu', '1')}>
              Neues Element
            </Button>
          )
        }
      />
      {creating && <AssetForm onClose={(createdId) => (createdId ? navigate(`/elemente/${createdId}`) : setParam('neu'))} />}
      {selected && <AssetDrawer asset={selected} onClose={() => setSelected(null)} />}

      <div className="mb-4 flex flex-col gap-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-3" />
          <Input placeholder="Code, Standort, Hersteller, Objekt …" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
          <Chip active={!category} onClick={() => setParam('kategorie')}>
            Alle Arten
          </Chip>
          {CATEGORY_LIST.map((c) => (
            <Chip key={c.key} active={category === c.key} onClick={() => setParam('kategorie', category === c.key ? undefined : c.key)}>
              {c.plural}
            </Chip>
          ))}
          <span className="mx-1 w-px shrink-0 bg-line" />
          {DUE_FILTERS.map((f) => (
            <Chip key={f.value} active={due === f.value} onClick={() => setParam('status', due === f.value ? undefined : f.value)}>
              {f.label}
            </Chip>
          ))}
        </div>
      </div>

      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : !data?.length ? (
        <Card>
          <Empty icon={<Package className="size-5" />} title="Keine Elemente gefunden" text={q || category || due ? 'Passe Suche oder Filter an.' : 'Lege dein erstes Element an.'} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="border-b border-line px-5 py-2.5 text-xs text-ink-3">{data.length} Elemente</div>
          <AssetList assets={data} onSelect={setSelected} />
        </Card>
      )}
    </>
  );
}

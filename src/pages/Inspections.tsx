import { ClipboardCheck, FileText, ScanLine } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { INSPECTION_KINDS } from '../../shared/catalog';
import { type Asset, useAssets, useDashboard, useInspections } from '../api';
import { AssetDrawer } from '../components/AssetDrawer';
import { AssetList } from '../components/AssetList';
import { CategoryIcon } from '../components/CategoryIcon';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Segmented, Spinner } from '../components/ui';
import { fmtDateTime, RESULT_META } from '../format';

type Tab = 'overdue' | 'soon' | 'never' | 'drafts' | 'done';

export function InspectionsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'overdue';
  const { data: dash } = useDashboard();
  const c = dash?.counts;
  return (
    <>
      <PageHeader
        title="Prüfungen"
        subtitle="Was steht an, was ist erledigt"
        actions={
          <Link to="/scan">
            <Button icon={<ScanLine className="size-4" />}>Prüfung starten</Button>
          </Link>
        }
      />
      <Segmented
        className="mb-4"
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
        options={[
          { value: 'overdue', label: 'Überfällig', count: c?.overdue },
          { value: 'soon', label: 'Bald fällig', count: c?.soon },
          { value: 'never', label: 'Nie geprüft', count: c?.never },
          { value: 'drafts', label: 'Entwürfe', count: c?.drafts },
          { value: 'done', label: 'Durchgeführt' },
        ]}
      />
      {tab === 'drafts' || tab === 'done' ? <InspectionList status={tab === 'drafts' ? 'draft' : 'submitted'} /> : <DueList due={tab} />}
    </>
  );
}

function DueList({ due }: { due: 'overdue' | 'soon' | 'never' }) {
  const { data, isLoading, error } = useAssets({ due });
  const [selected, setSelected] = useState<Asset | null>(null);
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const texts = {
    overdue: ['Nichts überfällig', 'Alle Elemente sind innerhalb ihres Prüfintervalls.'],
    soon: ['Nichts bald fällig', 'In den nächsten 30 Tagen läuft kein Prüfintervall ab.'],
    never: ['Alles mindestens einmal geprüft', 'Neu angelegte Elemente erscheinen hier bis zur Erstprüfung.'],
  }[due];
  return (
    <>
      {selected && <AssetDrawer asset={selected} onClose={() => setSelected(null)} />}
      <Card className="overflow-hidden">
        {!data?.length ? (
          <Empty icon={<ClipboardCheck className="size-5" />} title={texts[0]} text={texts[1]} />
        ) : (
          <AssetList assets={data} onSelect={setSelected} />
        )}
      </Card>
    </>
  );
}

function InspectionList({ status }: { status: 'draft' | 'submitted' }) {
  const { data, isLoading, error } = useInspections(status);
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  return (
    <Card className="overflow-hidden">
      {!data?.length ? (
        <Empty icon={<FileText className="size-5" />} title={status === 'draft' ? 'Keine offenen Entwürfe' : 'Noch keine Prüfungen'} />
      ) : (
        <ul className="divide-y divide-line">
          {data.map((i) => (
            <li key={i.id}>
              <Link
                to={status === 'draft' ? `/pruefung/${i.id}` : `/druck/protokoll/${i.id}`}
                className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/60 sm:px-5"
              >
                <CategoryIcon category={i.category} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {i.code} <span className="font-normal text-ink-3">· {INSPECTION_KINDS[i.kind]}</span>
                  </span>
                  <span className="block truncate text-xs text-ink-3">
                    {[i.location, i.buildingName, i.propertyName].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="hidden text-right text-xs text-ink-3 sm:block">
                  {fmtDateTime(i.inspectedAt ?? i.createdAt)}
                  <br />
                  {i.inspector}
                </span>
                {i.status === 'draft' ? <Badge tone="info">Entwurf</Badge> : i.result && <Badge tone={RESULT_META[i.result].tone}>{RESULT_META[i.result].label}</Badge>}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

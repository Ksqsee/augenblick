import { Archive, ClipboardCheck, Download, FileText, ScanLine, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, archiveReport, type Asset, useAction, useAssets, useDashboard, useInspections, useMe } from '../api';
import { allCategories, scheduleLabel, schedulesFor } from '../categories';
import { AssetDrawer } from '../components/AssetDrawer';
import { AssetList } from '../components/AssetList';
import { CategoryIcon } from '../components/CategoryIcon';
import { Badge, Button, Card, Chip, Empty, ErrorBox, PageHeader, Segmented, Spinner, useToast } from '../components/ui';
import { INSPECTION_PURPOSES } from '../../shared/catalog';
import { fmtDateTime, RESULT_META } from '../format';

type Tab = 'overdue' | 'soon' | 'never' | 'not_inspectable' | 'new' | 'drafts' | 'done' | 'archive' | 'corrected';
type DueTab = 'overdue' | 'soon' | 'never' | 'not_inspectable' | 'new';

/** Alle vorkommenden Prüfarten (Schlüssel → Bezeichnung) über alle Elementarten. */
function scheduleOptions() {
  const m = new Map<string, string>();
  for (const c of allCategories()) for (const s of schedulesFor(c.key)) if (!m.has(s.key)) m.set(s.key, s.key === 'main' ? 'Hauptprüfung' : s.label);
  return [...m];
}

export function InspectionsPage() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'overdue';
  const schedule = params.get('pruefart') ?? '';
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
          { value: 'not_inspectable', label: 'Nicht prüfbar', count: c?.notInspectable },
          { value: 'new', label: 'Neue Elemente', count: c?.newAssets },
          { value: 'drafts', label: 'Entwürfe', count: c?.drafts },
          { value: 'done', label: 'Durchgeführt' },
          { value: 'archive', label: 'Archiv' },
          { value: 'corrected', label: 'Berichtigt' },
        ]}
      />
      {tab === 'drafts' || tab === 'done' || tab === 'archive' || tab === 'corrected' ? (
        <InspectionList key={tab} status={tab === 'drafts' ? 'draft' : 'submitted'} archived={tab === 'archive'} corrected={tab === 'corrected'} />
      ) : (
        <DueList due={tab} schedule={tab === 'new' ? '' : schedule} onSchedule={(v) => setParams(v ? { tab, pruefart: v } : { tab }, { replace: true })} />
      )}
    </>
  );
}

function DueList({ due, schedule, onSchedule }: { due: DueTab; schedule: string; onSchedule: (v: string) => void }) {
  const { data, isLoading, error } = useAssets({ due, schedule: schedule || undefined });
  const [selected, setSelected] = useState<Asset | null>(null);
  const options = scheduleOptions();
  const chips = due !== 'new' && options.length > 1 && (
    <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Nach Prüfart filtern">
      <Chip active={!schedule} onClick={() => onSchedule('')}>
        Alle Prüfarten
      </Chip>
      {options.map(([k, label]) => (
        <Chip key={k} active={schedule === k} onClick={() => onSchedule(k)}>
          {label}
        </Chip>
      ))}
    </div>
  );
  if (isLoading) return <>{chips}<Spinner /></>;
  if (error) return <ErrorBox error={error} />;
  const texts = {
    overdue: ['Nichts überfällig', 'Alle Elemente sind innerhalb ihres Prüfintervalls.'],
    soon: ['Nichts bald fällig', 'In den nächsten 30 Tagen läuft kein Prüfintervall ab.'],
    never: ['Alles mindestens einmal geprüft', 'Neu angelegte Elemente erscheinen hier bis zur Erstprüfung.'],
    not_inspectable: ['Keine offenen „nicht prüfbar“', 'Elemente, die beim letzten Termin nicht zugänglich waren, erscheinen hier.'],
    new: ['Keine neuen Elemente', 'Hier stehen Elemente, die in den letzten 30 Tagen angelegt wurden.'],
  }[due];
  return (
    <>
      {selected && <AssetDrawer asset={selected} onClose={() => setSelected(null)} />}
      {chips}
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

function InspectionList({ status, archived, corrected }: { status: 'draft' | 'submitted'; archived: boolean; corrected: boolean }) {
  const { data, isLoading, error } = useInspections(corrected ? { superseded: '1' } : { status, archived: archived ? '1' : undefined });
  const { data: me } = useMe();
  const toast = useToast();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState<string | null>(null);
  const isAdmin = me && ['owner', 'admin'].includes(me.user.role);
  const selectable = status === 'submitted' && !corrected;
  const archive = useAction((v: { ids: string[]; archived: boolean }) => api<{ changed: number }>('/inspections/archive', { body: v }), (r, v) => {
    toast(`${r.changed} ${v.archived ? 'archiviert' : 'wiederhergestellt'}`);
    setSel(new Set());
  });
  const del = useAction((ids: string[]) => api<{ deleted: number }>('/inspections/batch-delete', { body: { ids } }), (r) => {
    toast(`${r.deleted} Prüfungen gelöscht`);
    setSel(new Set());
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  const rows = data ?? [];
  const toggle = (id: string) => setSel((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id);
    else n.add(id);
    return n;
  });
  const zip = async () => {
    if (!me) return;
    try {
      const { protocolsZip, download } = await import('../pdf/reports');
      const bytes = await protocolsZip([...sel], me, (d, t) => setZipping(`${d}/${t}`));
      const fileName = `Pruefprotokolle_${new Date().toISOString().slice(0, 10)}.zip`;
      download(bytes, fileName, 'application/zip');
      await archiveReport(me, bytes, { kind: 'protocols', title: `${sel.size} Prüfprotokolle`, fileName }, 'application/zip').catch(() => false);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Export fehlgeschlagen', 'bad');
    } finally {
      setZipping(null);
    }
  };
  return (
    <>
      {selectable && rows.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <label className="mr-2 flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              className="size-4 accent-[var(--color-brand)]"
              checked={sel.size === rows.length}
              onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
            />
            {sel.size ? `${sel.size} ausgewählt` : 'Alle auswählen'}
          </label>
          {sel.size > 0 && (
            <>
              <Button size="sm" variant="secondary" icon={<Download className="size-3.5" />} loading={!!zipping} onClick={zip}>
                {zipping ? `PDF ${zipping}` : 'PDFs als ZIP'}
              </Button>
              {isAdmin && (
                <>
                  <Button size="sm" variant="secondary" icon={<Archive className="size-3.5" />} onClick={() => archive.mutate({ ids: [...sel], archived: !archived })}>
                    {archived ? 'Wiederherstellen' : 'Archivieren'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="text-bad"
                    icon={<Trash2 className="size-3.5" />}
                    onClick={() => confirm(`${sel.size} Prüfungen endgültig löschen? Termine werden neu berechnet.`) && del.mutate([...sel])}
                  >
                    Löschen
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      )}
      <Card className="overflow-hidden">
        {!rows.length ? (
          <Empty
            icon={<FileText className="size-5" />}
            title={corrected ? 'Keine berichtigten Prüfungen' : status === 'draft' ? 'Keine offenen Entwürfe' : archived ? 'Archiv ist leer' : 'Noch keine Prüfungen'}
            text={
              corrected
                ? 'Wird eine abgeschlossene Prüfung berichtigt, bleibt die ursprüngliche Fassung hier als Nachweis erhalten.'
                : archived
                  ? 'Archivierte Prüfungen bleiben als Nachweis erhalten, erscheinen aber nicht mehr in den Listen.'
                  : undefined
            }
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((i) => (
              <li key={i.id} className="flex items-center">
                {selectable && (
                  <label className="flex self-stretch items-center pl-4 sm:pl-5">
                    <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={sel.has(i.id)} onChange={() => toggle(i.id)} aria-label={`${i.code} auswählen`} />
                  </label>
                )}
                <Link
                  to={i.status === 'draft' ? `/pruefung/${i.id}` : `/druck/protokoll/${i.id}`}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 hover:bg-sunken/60 sm:px-5"
                >
                  <CategoryIcon category={i.category} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {i.code} <span className="font-normal text-ink-3">· {scheduleLabel(i.category, i.schedule ?? 'main')}</span>
                      {i.purpose && i.purpose !== 'regular' && (
                        <Badge tone="muted" className="ml-2">
                          {INSPECTION_PURPOSES[i.purpose]}
                        </Badge>
                      )}
                    </span>
                    <span className="block truncate text-xs text-ink-3">{[i.location, i.buildingName, i.propertyName].filter(Boolean).join(' · ')}</span>
                  </span>
                  <span className="hidden text-right text-xs text-ink-3 sm:block">
                    {fmtDateTime(i.inspectedAt ?? i.createdAt)}
                    <br />
                    {i.inspector}
                  </span>
                  {i.supersededAt ? (
                    <Badge tone="muted">Berichtigt</Badge>
                  ) : i.status === 'draft' ? (
                    <Badge tone="info">Entwurf</Badge>
                  ) : (
                    i.result && <Badge tone={RESULT_META[i.result].tone}>{RESULT_META[i.result].label}</Badge>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

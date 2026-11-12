import clsx from 'clsx';
import { Archive, ClipboardCheck, CloudDownload, Download, FileText, Footprints, ScanLine, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, archiveReport, type Asset, useAction, useAssets, useDashboard, useInspections, useMe } from '../api';
import { allCategories, scheduleLabel, schedulesFor } from '../categories';
import { AssetDrawer } from '../components/AssetDrawer';
import { CategoryIcon } from '../components/CategoryIcon';
import { Badge, Button, Card, Chip, Empty, ErrorBox, List, ListRow, Menu, PageHeader, ResultBadge, SkeletonList, StatusDot, Tabs, useConfirm, useToast } from '../components/ui';
import { INSPECTION_PURPOSES } from '../../shared/catalog';
import { summarizeSchedules } from '../../shared/logic';
import { EMPTY_FILTER, filterParams, type InspectionFilter, InspectionFilters } from '../components/InspectionFilters';
import { assetDue, categoryLabel, defectsLabel, DUE_META, fmtDate, fmtDateTime, fmtRelative } from '../format';

type Tab = 'overdue' | 'soon' | 'never' | 'not_inspectable' | 'new' | 'drafts' | 'done' | 'archive' | 'corrected';
type DueTab = 'overdue' | 'soon' | 'never' | 'not_inspectable' | 'new';
const TABS: Tab[] = ['overdue', 'soon', 'never', 'not_inspectable', 'new', 'drafts', 'done', 'archive', 'corrected'];

/** Alle vorkommenden Prüfarten (Schlüssel → Bezeichnung) über alle Elementarten. */
function scheduleOptions() {
  const m = new Map<string, string>();
  for (const c of allCategories()) for (const s of schedulesFor(c.key)) if (!m.has(s.key)) m.set(s.key, s.key === 'main' ? 'Hauptprüfung' : s.label);
  return [...m];
}

export function InspectionsPage() {
  const [params, setParams] = useSearchParams();
  const raw = params.get('tab') as Tab | null;
  const tab: Tab = raw && TABS.includes(raw) ? raw : 'overdue';
  const schedule = params.get('pruefart') ?? '';
  const { data: dash } = useDashboard();
  const c = dash?.counts;
  return (
    <>
      <PageHeader
        title="Prüfungen"
        subtitle="Was fällig ist, was läuft, was erledigt ist"
        actions={
          <>
            <Link to="/scan">
              <Button icon={<ScanLine />}>Code scannen</Button>
            </Link>
            <Menu
              items={[
                { label: 'Begehungen', icon: <Footprints />, to: '/begehungen' },
                { label: 'Offline vorbereiten', icon: <CloudDownload />, to: '/offline' },
              ]}
            />
          </>
        }
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={(v) => setParams({ tab: v }, { replace: true })}
        tabs={[
          { value: 'overdue', label: 'Überfällig', count: c?.overdue, tone: 'bad' },
          { value: 'soon', label: 'Bald fällig', count: c?.soon, tone: 'warn' },
          { value: 'never', label: 'Nie geprüft', count: c?.never, tone: 'info' },
          { value: 'not_inspectable', label: 'Nicht prüfbar', count: c?.notInspectable },
          { value: 'new', label: 'Neue Elemente', count: c?.newAssets },
          { value: 'drafts', label: 'Entwürfe', count: c?.drafts, tone: 'info' },
          { value: 'done', label: 'Durchgeführt' },
          { value: 'archive', label: 'Archiv' },
          { value: 'corrected', label: 'Berichtigt' },
        ]}
      />
      {tab === 'drafts' || tab === 'done' || tab === 'archive' || tab === 'corrected' ? (
        <InspectionList key={tab} status={tab === 'drafts' ? 'draft' : 'submitted'} archived={tab === 'archive'} corrected={tab === 'corrected'} />
      ) : (
        <DueList key={tab} due={tab} schedule={tab === 'new' ? '' : schedule} onSchedule={(v) => setParams(v ? { tab, pruefart: v } : { tab }, { replace: true })} />
      )}
    </>
  );
}

/** Fälligkeit in Worten, z. B. „seit 4 Monaten“, „in 12 Tagen“. */
function dueText(a: Asset): { text: string; tone: 'bad' | 'warn' | 'info' | 'ok' | 'muted' } {
  if (a.lastResult === 'not_inspectable') return { text: 'nicht prüfbar', tone: 'muted' };
  const s = assetDue(a.nextDueAt);
  if (s === 'never') return { text: 'nie geprüft', tone: 'info' };
  const r = fmtRelative(a.nextDueAt);
  if (s === 'overdue') return { text: r.startsWith('vor ') ? `seit ${r.slice(4)}` : 'überfällig', tone: 'bad' };
  return { text: r === 'heute' ? 'heute fällig' : `fällig ${r}`, tone: DUE_META[s].tone as 'warn' | 'ok' };
}

function DueList({ due, schedule, onSchedule }: { due: DueTab; schedule: string; onSchedule: (v: string) => void }) {
  const { data, isLoading, error, refetch } = useAssets({ due, schedule: schedule || undefined });
  const [selected, setSelected] = useState<Asset | null>(null);
  const options = scheduleOptions();
  const chips = due !== 'new' && options.length > 1 && (
    <div className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0" role="group" aria-label="Nach Prüfart filtern">
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
  const texts = {
    overdue: ['Nichts überfällig', 'Alle Elemente liegen innerhalb ihres Prüfintervalls.'],
    soon: ['Nichts bald fällig', 'In den nächsten 30 Tagen läuft kein Prüfintervall ab.'],
    never: ['Alles mindestens einmal geprüft', 'Neu angelegte Elemente erscheinen hier bis zur Erstprüfung.'],
    not_inspectable: ['Nichts offen', 'Elemente, die beim letzten Termin nicht zugänglich waren, erscheinen hier.'],
    new: ['Keine neuen Elemente', 'Hier stehen Elemente, die in den letzten 30 Tagen angelegt wurden.'],
  }[due];
  return (
    <>
      {selected && <AssetDrawer asset={selected} onClose={() => setSelected(null)} />}
      {chips}
      {isLoading ? (
        <SkeletonList rows={6} />
      ) : error ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : !data?.length ? (
        <Card>
          <Empty
            icon={<ClipboardCheck />}
            title={schedule ? 'Keine Treffer' : texts[0]}
            text={schedule ? 'Für diese Prüfart ist hier nichts offen.' : texts[1]}
            action={
              schedule ? (
                <Button variant="secondary" onClick={() => onSchedule('')}>
                  Filter zurücksetzen
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <List header={<span>{data.length === 1 ? '1 Element' : `${data.length} Elemente`}</span>} aria-label="Elemente">
          {data.map((a) => {
            const dt = dueText(a);
            const k = a.schedules ? summarizeSchedules(a.schedules).nextKey : null;
            return (
              <ListRow
                key={a.id}
                onClick={() => setSelected(a)}
                leading={<CategoryIcon category={a.category} size="sm" />}
                title={
                  <>
                    {a.code} <span className="font-normal text-ink-3 max-sm:hidden">· {categoryLabel(a.category)}</span>
                  </>
                }
                subtitle={[a.location, a.floor, a.buildingName, a.propertyName].filter(Boolean).join(' · ') || '–'}
                meta={
                  <span className="flex flex-col items-end leading-tight">
                    <span className="text-caption text-ink-3">{k && k !== 'main' ? scheduleLabel(a.category, k) : 'nächste Prüfung'}</span>
                    <span className="font-medium text-ink-2">{fmtDate(a.nextDueAt)}</span>
                  </span>
                }
                trailing={
                  <span className="flex flex-col items-end gap-1 sm:min-w-32 sm:items-start">
                    <span className="flex items-center gap-1.5 text-meta whitespace-nowrap text-ink-2 tabular-nums">
                      <StatusDot tone={dt.tone} />
                      {dt.text}
                    </span>
                    {a.openDefects > 0 && <span className="text-caption text-warn">{defectsLabel(a.openDefects)}</span>}
                  </span>
                }
                chevron
              />
            );
          })}
        </List>
      )}
    </>
  );
}

function InspectionList({ status, archived, corrected }: { status: 'draft' | 'submitted'; archived: boolean; corrected: boolean }) {
  const [filter, setFilter] = useState<InspectionFilter>(EMPTY_FILTER);
  const [showFilters, setShowFilters] = useState(false);
  const { data, isLoading, error, refetch } = useInspections({
    ...(corrected ? { superseded: '1' } : { status, archived: archived ? '1' : undefined }),
    ...(status === 'submitted' ? filterParams(filter) : {}),
  });
  const { data: me } = useMe();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [zipping, setZipping] = useState<string | null>(null);
  const isAdmin = me && ['owner', 'admin'].includes(me.user.role);
  const selectable = status === 'submitted' && !corrected;
  const active = Object.entries(filter).filter(([, v]) => v).length;
  const archive = useAction((v: { ids: string[]; archived: boolean }) => api<{ changed: number }>('/inspections/archive', { body: v }), (r, v) => {
    toast(`${r.changed} ${v.archived ? 'archiviert' : 'wiederhergestellt'}`);
    setSel(new Set());
  });
  const del = useAction((ids: string[]) => api<{ deleted: number }>('/inspections/batch-delete', { body: { ids } }), (r) => {
    toast(`${r.deleted} Prüfungen gelöscht`);
    setSel(new Set());
  });
  const filters = status === 'submitted' && (
    <div className="mb-4">
      <div className="mb-2 sm:hidden">
        <Chip active={showFilters || active > 0} onClick={() => setShowFilters(!showFilters)} icon={<SlidersHorizontal />} count={active || undefined}>
          Filter
        </Chip>
      </div>
      <div className={clsx(!showFilters && 'max-sm:hidden')}>
        <InspectionFilters value={filter} onChange={(f) => (setFilter(f), setSel(new Set()))} />
      </div>
    </div>
  );
  const rows = data ?? [];
  const toggle = (id: string) =>
    setSel((s) => {
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
      {confirmEl}
      {filters}
      {isLoading ? (
        <SkeletonList rows={6} />
      ) : error ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : !rows.length ? (
        <Card>
          <Empty
            icon={<FileText />}
            title={active ? 'Keine Treffer' : corrected ? 'Keine berichtigten Prüfungen' : status === 'draft' ? 'Keine offenen Entwürfe' : archived ? 'Archiv ist leer' : 'Noch keine Prüfungen'}
            text={
              active
                ? 'Mit diesen Filtern gibt es keine Prüfungen.'
                : corrected
                  ? 'Wird eine abgeschlossene Prüfung berichtigt, bleibt die ursprüngliche Fassung hier als Nachweis erhalten.'
                  : archived
                    ? 'Archivierte Prüfungen bleiben als Nachweis erhalten, erscheinen aber nicht mehr in den Listen.'
                    : status === 'draft'
                      ? 'Begonnene Prüfungen erscheinen hier, bis du sie abschließt.'
                      : 'Scanne den Code an einem Element, um die erste Prüfung zu starten.'
            }
            action={
              active ? (
                <Button variant="secondary" onClick={() => setFilter(EMPTY_FILTER)}>
                  Filter zurücksetzen
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {selectable && (
            <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-line px-4 py-2">
              <label className="mr-auto flex items-center gap-2.5 text-meta text-ink-2">
                <input
                  type="checkbox"
                  className="size-4 accent-ink"
                  checked={sel.size === rows.length}
                  onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())}
                />
                {sel.size ? `${sel.size} ausgewählt` : `${rows.length} Prüfungen`}
              </label>
              {sel.size > 0 && (
                <>
                  <Button size="sm" variant="secondary" icon={<Download />} loading={!!zipping} onClick={zip}>
                    {zipping ? `PDF ${zipping}` : 'PDFs als ZIP'}
                  </Button>
                  {isAdmin && (
                    <>
                      <Button size="sm" variant="secondary" icon={<Archive />} onClick={() => archive.mutate({ ids: [...sel], archived: !archived })}>
                        {archived ? 'Wiederherstellen' : 'Archivieren'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-bad"
                        icon={<Trash2 />}
                        onClick={async () => {
                          if (await confirm({ title: `${sel.size} Prüfungen endgültig löschen?`, text: 'Die Termine der Elemente werden neu berechnet.', confirmLabel: 'Löschen', danger: true }))
                            del.mutate([...sel]);
                        }}
                      >
                        Löschen
                      </Button>
                    </>
                  )}
                </>
              )}
            </div>
          )}
          <ul className="divide-y divide-line" aria-label="Prüfungen">
            {rows.map((i) => (
              <li key={i.id} className={clsx('flex items-center transition-colors hover:bg-hover', sel.has(i.id) && 'bg-brand-soft/50')}>
                {selectable && (
                  <label className="flex cursor-pointer items-center self-stretch pl-4">
                    <input type="checkbox" className="size-4 accent-ink" checked={sel.has(i.id)} onChange={() => toggle(i.id)} aria-label={`${i.code} auswählen`} />
                  </label>
                )}
                <Link to={i.status === 'draft' ? `/pruefung/${i.id}` : `/druck/protokoll/${i.id}`} className="group flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-2.5 sm:min-h-12">
                  <CategoryIcon category={i.category} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2 text-body font-medium">
                      <span className="truncate">
                        {i.code} <span className="font-normal text-ink-3">· {scheduleLabel(i.category, i.schedule ?? 'main')}</span>
                      </span>
                      {i.purpose && i.purpose !== 'regular' && (
                        <Badge tone="muted" variant="outline" size="sm">
                          {INSPECTION_PURPOSES[i.purpose]}
                        </Badge>
                      )}
                    </span>
                    <span className="mt-0.5 block truncate text-meta text-ink-3">
                      <span className="sm:hidden">{fmtDate(i.inspectedAt ?? i.createdAt)} · </span>
                      {[i.location, i.buildingName, i.propertyName].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className="hidden shrink-0 text-right text-meta text-ink-3 tabular-nums sm:block">
                    {fmtDateTime(i.inspectedAt ?? i.createdAt)}
                    <span className="block text-caption">{i.inspector}</span>
                  </span>
                  {i.supersededAt ? (
                    <Badge tone="muted">Berichtigt</Badge>
                  ) : i.status === 'draft' ? (
                    <Badge tone="info" dot>
                      Entwurf
                    </Badge>
                  ) : (
                    i.result && <ResultBadge result={i.result} />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

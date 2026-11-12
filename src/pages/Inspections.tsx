import clsx from 'clsx';
import { Archive, CloudDownload, Download, Footprints, ScanLine, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, archiveReport, type Asset, useAction, useAssets, useDashboard, useInspections, useMe } from '../api';
import { allCategories, scheduleLabel, schedulesFor } from '../categories';
import { AssetDrawer } from '../components/AssetDrawer';
import { CategoryGlyph } from '../components/inspect/Glyph';
import { Button, ButtonLink, Chip, Empty, ErrorBox, List, ListRow, Menu, PageHeader, ResultBadge, Section, SkeletonList, StatusText, Surface, Tabs, useConfirm, useToast } from '../components/ui';
import { INSPECTION_PURPOSES } from '../../shared/catalog';
import { summarizeSchedules } from '../../shared/logic';
import { EMPTY_FILTER, filterParams, type InspectionFilter, InspectionFilters } from '../components/InspectionFilters';
import { assetDue, categoryLabel, defectsLabel, DUE_META, fmtDate, fmtRelative } from '../format';

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
            <ButtonLink to="/scan" icon={<ScanLine />}>
              Code scannen
            </ButtonLink>
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
        <Surface>
          <Empty
            title={schedule ? 'Keine Treffer' : texts[0]}
            text={schedule ? 'Für diese Prüfart ist hier nichts offen.' : texts[1]}
            action={
              schedule ? (
                <Button variant="ghost" onClick={() => onSchedule('')}>
                  Filter zurücksetzen
                </Button>
              ) : undefined
            }
          />
        </Surface>
      ) : (
        <Surface>
          <Section title={data.length === 1 ? '1 Element' : `${data.length} Elemente`} flush>
            <List plain aria-label="Elemente">
              {data.map((a) => {
                const dt = dueText(a);
                const k = a.schedules ? summarizeSchedules(a.schedules).nextKey : null;
                // eine Meta-Zeile: Ort, ggf. Prüfart und offene Mängel als Text
                const sub = [
                  [a.location, a.floor, a.buildingName].filter(Boolean).join(', ') || a.propertyName || '–',
                  k && k !== 'main' ? scheduleLabel(a.category, k) : null,
                  a.openDefects > 0 ? defectsLabel(a.openDefects) : null,
                ]
                  .filter(Boolean)
                  .join(' · ');
                return (
                  <ListRow
                    key={a.id}
                    onClick={() => setSelected(a)}
                    leading={<CategoryGlyph category={a.category} />}
                    title={
                      <>
                        {a.code} <span className="text-ink-3 max-sm:hidden">· {categoryLabel(a.category)}</span>
                      </>
                    }
                    subtitle={sub}
                    trailing={
                      <span title={a.nextDueAt ? `nächste Prüfung ${fmtDate(a.nextDueAt)}` : undefined}>
                        <StatusText tone={dt.tone}>{dt.text}</StatusText>
                      </span>
                    }
                    chevron
                  />
                );
              })}
            </List>
          </Section>
        </Surface>
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
        <Surface>
          <Empty
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
                <Button variant="ghost" onClick={() => setFilter(EMPTY_FILTER)}>
                  Filter zurücksetzen
                </Button>
              ) : undefined
            }
          />
        </Surface>
      ) : (
        <Surface>
          {selectable && (
            <div className="flex min-h-12 flex-wrap items-center gap-2 border-b border-line px-(--row-px) py-2">
              <label className="mr-auto flex items-center gap-3 text-meta text-ink-3">
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
          <ul className="pk-list" aria-label="Prüfungen" style={{ '--row-inset': selectable ? '56px' : '28px' } as React.CSSProperties}>
            {rows.map((i) => (
              <li key={i.id} className={clsx('flex items-center transition-colors hover:bg-hover', sel.has(i.id) && 'bg-selected')}>
                {selectable && (
                  <label className="flex cursor-pointer items-center self-stretch pl-(--row-px)">
                    <input type="checkbox" className="size-4 accent-ink" checked={sel.has(i.id)} onChange={() => toggle(i.id)} aria-label={`${i.code} auswählen`} />
                  </label>
                )}
                <Link to={i.status === 'draft' ? `/pruefung/${i.id}` : `/druck/protokoll/${i.id}`} className="group flex min-h-[52px] min-w-0 flex-1 items-center gap-3 px-(--row-px) py-2 sm:min-h-11">
                  <CategoryGlyph category={i.category} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink">
                      {i.code} <span className="text-ink-3">· {scheduleLabel(i.category, i.schedule ?? 'main')}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-meta text-ink-3">
                      {[
                        fmtDate(i.inspectedAt ?? i.createdAt),
                        i.purpose && i.purpose !== 'regular' ? INSPECTION_PURPOSES[i.purpose] : null,
                        i.inspector,
                        [i.location, i.buildingName].filter(Boolean).join(', '),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  {i.supersededAt ? (
                    <StatusText tone="muted">Berichtigt</StatusText>
                  ) : i.status === 'draft' ? (
                    <StatusText tone="info">Entwurf</StatusText>
                  ) : (
                    i.result && <ResultBadge result={i.result} />
                  )}
                </Link>
              </li>
            ))}
          </ul>
        </Surface>
      )}
    </>
  );
}

// Reiter „Elemente“ des Objekts (Plan v8 Z): die Türliste als Tabelle – Nummer, Raum, Typ, letzte Prüfung, Ergebnis,
// nächste Prüfung –, Filter nach Stand (?stand=) und Art, Suche, „Element“ je Gebäude, „Elemente hinzufügen“ und Import.
// Je Gebäude ein Abschnitt, erst ab zwei Gebäuden. Auf dem Handy werden die Zeilen gestapelt (PlainTable).
import { CloudDownload, Mic, Pencil, Plus, Trash2, Upload } from 'lucide-react';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, type Asset, type PropertyDetail, useAction } from '../../api';
import { assetDue, categoryLabel, fmtDate } from '../../format';
import { prepareBuilding } from '../../offline';
import { openCapture } from '../CaptureSheet';
import { AssetForm, BuildingForm } from '../forms';
import { Button, ButtonLink, type Column, Empty, Menu, type MenuItem, ResultBadge, SearchField, Section, Surface, useConfirm, useToast } from '../ui';
import { FilterSelect } from './FilterSelect';
import { PlainTable } from './PlainTable';
import { DuePhrase } from './status';

const STAND = {
  alle: 'Alle',
  faellig: 'Fällig',
  nie: 'Nie geprüft',
  maengel: 'Mit Mängeln',
  aktuell: 'Aktuell',
} as const;
type Stand = keyof typeof STAND;

const inStand = (a: Asset, s: Stand) => {
  const d = a.lastResult === 'not_inspectable' ? 'muted' : assetDue(a.nextDueAt);
  if (s === 'faellig') return d === 'overdue' || d === 'soon';
  if (s === 'nie') return d === 'never';
  if (s === 'aktuell') return d === 'ok';
  if (s === 'maengel') return a.openDefects > 0;
  return true;
};
const matches = (a: Asset, needle: string) => [a.code, a.location, a.floor, categoryLabel(a.category), a.manufacturer, a.model].join(' ').toLowerCase().includes(needle);
const byNumber = (a: Asset, b: Asset) => (a.number ?? 1e9) - (b.number ?? 1e9) || a.code.localeCompare(b.code, 'de', { numeric: true });

const columns: Column<Asset>[] = [
  { key: 'code', header: 'Nummer', cell: (a) => <span className="font-medium">{a.code}</span>, className: 'w-28' },
  { key: 'room', header: 'Raum', cell: (a) => [a.location, a.floor].filter(Boolean).join(' · ') || '–' },
  { key: 'type', header: 'Typ', cell: (a) => [a.manufacturer, a.model].filter(Boolean).join(' ') || categoryLabel(a.category), mobile: 'secondary' },
  { key: 'last', header: 'Letzte Prüfung', cell: (a) => (a.lastInspectedAt ? fmtDate(a.lastInspectedAt) : '–'), className: 'whitespace-nowrap', mobile: 'hidden' },
  { key: 'result', header: 'Ergebnis', cell: (a) => (a.lastResult ? <ResultBadge result={a.lastResult} /> : <span className="text-ink-4">–</span>), mobile: 'hidden' },
  { key: 'next', header: 'Nächste Prüfung', cell: (a) => <DuePhrase asset={a} />, className: 'whitespace-nowrap' },
];

export function ElementsTab({ p, isAdmin, canCreate }: { p: PropertyDetail; isAdmin: boolean; canCreate: boolean }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [params, setParams] = useSearchParams();
  const stand = (Object.keys(STAND) as Stand[]).includes(params.get('stand') as Stand) ? (params.get('stand') as Stand) : 'alle';
  const setStand = (s: Stand) =>
    setParams(
      (q) => {
        const n = new URLSearchParams(q);
        if (s === 'alle') n.delete('stand');
        else n.set('stand', s);
        return n;
      },
      { replace: true },
    );
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [assetFor, setAssetFor] = useState<string | null>(null);
  const [building, setBuilding] = useState<null | 'new' | { id: string; name: string; address: string }>(null);
  const [preparing, setPreparing] = useState<string | null>(null);
  const delBuilding = useAction((bid: string) => api(`/buildings/${bid}`, { method: 'DELETE' }), () => toast('Gebäude gelöscht'));
  const offline = async (bid: string) => {
    setPreparing(bid);
    try {
      const b = await prepareBuilding(bid);
      toast(`${b.assets.length} Elemente offline verfügbar`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Fehler', 'bad');
    } finally {
      setPreparing(null);
    }
  };

  const needle = q.trim().toLowerCase();
  const cats = [...new Set(p.assets.map((a) => a.category))];
  const pick = (list: Asset[]) => list.filter((a) => inStand(a, stand) && (!cat || a.category === cat) && (!needle || matches(a, needle))).sort(byNumber);
  const filtered = pick(p.assets);
  const single = p.buildings.length === 1 ? p.buildings[0]! : null;
  const filtering = stand !== 'alle' || !!cat || !!needle;
  const counts = (Object.keys(STAND) as Stand[]).map((s) => ({ s, n: p.assets.filter((a) => inStand(a, s)).length }));

  const addButton = (bid: string) =>
    canCreate && (
      <Button size="sm" variant="ghost" icon={<Plus />} onClick={() => setAssetFor(bid)}>
        Element
      </Button>
    );
  const table = (list: Asset[], label: string) => <PlainTable columns={columns} rows={list} rowKey={(a) => a.id} rowTo={(a) => `/elemente/${a.id}`} aria-label={label} />;

  return (
    <>
      {confirmEl}
      {assetFor && <AssetForm buildings={p.buildings} propertyId={p.id} defaultBuildingId={assetFor} onClose={() => setAssetFor(null)} />}
      {building && <BuildingForm propertyId={p.id} initial={building === 'new' ? undefined : building} onClose={() => setBuilding(null)} />}
      <Surface data-detail-surface>
        {p.buildings.length === 0 ? (
          <Section>
            <Empty
              title="Noch kein Gebäude"
              text="Lege mindestens ein Gebäude an. Darin erfasst du Türen, Klappen, Löscher und Melder."
              action={
                isAdmin && (
                  <Button variant="secondary" icon={<Plus className="size-4" />} onClick={() => setBuilding('new')}>
                    Gebäude anlegen
                  </Button>
                )
              }
            />
          </Section>
        ) : (
          <>
            <Section className="py-4 sm:py-4" aria-label="Filter">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                {p.assets.length > 0 && (
                  <div className="no-scrollbar -mx-(--row-px) flex gap-1.5 overflow-x-auto px-(--row-px) lg:mx-0 lg:px-0" role="group" aria-label="Nach Stand filtern">
                    {counts
                      .filter((c) => c.s === 'alle' || c.n > 0 || c.s === stand)
                      .map((c) => (
                        <button
                          key={c.s}
                          type="button"
                          aria-pressed={stand === c.s}
                          onClick={() => setStand(stand === c.s ? 'alle' : c.s)}
                          className={
                            stand === c.s
                              ? 'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-line-strong bg-selected px-3 text-meta font-medium text-ink sm:h-8'
                              : 'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-meta font-medium text-ink-2 hover:border-line-strong hover:text-ink sm:h-8'
                          }
                        >
                          {STAND[c.s]}
                          <span className="font-normal text-ink-3 tabular-nums">{c.n}</span>
                        </button>
                      ))}
                  </div>
                )}
                <div className="flex min-w-0 flex-1 gap-2 lg:justify-end">
                  {cats.length > 1 && (
                    <FilterSelect label="Nach Art filtern" value={cat} onChange={setCat}>
                      <option value="">Alle Arten</option>
                      {cats.map((c) => (
                        <option key={c} value={c}>
                          {categoryLabel(c)}
                        </option>
                      ))}
                    </FilterSelect>
                  )}
                  {p.assets.length > 5 && <SearchField value={q} onChange={setQ} placeholder="Nummer, Raum, Typ …" label="In diesem Objekt suchen" className="min-w-0 flex-1 lg:max-w-64" />}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {canCreate && (
                  <Button size="sm" variant="secondary" icon={<Mic />} onClick={() => openCapture({ propertyId: p.id, mode: 'assets' })}>
                    Elemente hinzufügen
                  </Button>
                )}
                {isAdmin && (
                  <ButtonLink size="sm" variant="ghost" icon={<Upload />} to="/einstellungen/import">
                    Import
                  </ButtonLink>
                )}
              </div>
            </Section>
            {single && (
              <Section aria-label="Elemente" flush title="Elemente" count={filtering ? filtered.length : p.assets.length} action={addButton(single.id)}>
                {p.assets.length === 0 ? (
                  <Empty compact title="Noch keine Elemente" text="Sprich oder tippe, was hier verbaut ist – z. B. „drei Feuerschutztüren im EG Flur, T30 von Hörmann“." />
                ) : filtered.length ? (
                  table(filtered, 'Elemente')
                ) : null}
              </Section>
            )}
            {!single &&
              p.buildings.map((b) => {
                const inBuilding = p.assets.filter((a) => a.buildingId === b.id);
                const list = pick(inBuilding);
                if (filtering && !list.length) return null;
                const bMenu: MenuItem[] = [
                  { label: preparing === b.id ? 'Wird gespeichert …' : 'Für offline speichern', icon: <CloudDownload />, disabled: preparing === b.id, onClick: () => offline(b.id) },
                ];
                if (isAdmin)
                  bMenu.push({ label: 'Gebäude bearbeiten', icon: <Pencil />, onClick: () => setBuilding(b) }, 'separator', {
                    label: 'Gebäude löschen',
                    icon: <Trash2 />,
                    danger: true,
                    onClick: async () => {
                      if (await confirm({ title: `Gebäude „${b.name}“ löschen?`, text: `Die ${inBuilding.length} Elemente darin werden mit gelöscht.`, confirmLabel: 'Löschen', danger: true }))
                        delBuilding.mutate(b.id);
                    },
                  });
                return (
                  <Section
                    key={b.id}
                    aria-label={b.name}
                    flush
                    title={<span className="truncate">{b.name}</span>}
                    count={filtering ? list.length : inBuilding.length}
                    action={
                      <>
                        <Menu items={bMenu} label={`Weitere Aktionen zu ${b.name}`} />
                        {addButton(b.id)}
                      </>
                    }
                  >
                    {b.address && <p className="-mt-1 mb-2 px-(--row-px) text-meta text-ink-3">{b.address.split('\n').join(', ')}</p>}
                    {list.length === 0 ? (
                      <p className="px-(--row-px) pb-3 text-body text-ink-2">Keine Elemente in diesem Gebäude. Lege Türen, Klappen, Löscher oder Melder an.</p>
                    ) : (
                      table(list, `Elemente in ${b.name}`)
                    )}
                  </Section>
                );
              })}
            {filtering && !filtered.length && p.assets.length > 0 && (
              <Section>
                <Empty
                  compact
                  title="Keine Treffer"
                  text={needle ? `Kein Element passt zu „${q.trim()}“.` : 'Kein Element mit diesem Stand.'}
                  action={
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setQ('');
                        setCat('');
                        setStand('alle');
                      }}
                    >
                      Filter zurücksetzen
                    </Button>
                  }
                />
              </Section>
            )}
          </>
        )}
      </Surface>
    </>
  );
}

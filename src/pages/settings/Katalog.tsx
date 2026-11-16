// Einstellungen → Katalog (v5 Paket P, v7 Paket V): vier schlichte Listen – typische Mängel (mit Zuordnung zu
// Leistungen), Produkte (Hersteller/Typ mit Aliassen, Anforderung, Vorgaben, Zulassung bis), Leistungen (Kürzel, Preis,
// Bedingung auf Stammdaten) und Begriffe. Dazu „Aus Datei laden“ (Katalog-Datei mit Vorschau, derselbe Stapel-Endpunkt
// wie MCP `catalog upsert`). Lesen ab Prüfer, Anlegen/Ändern/Löschen nur Admins (Server prüft, worker/catalog.ts).
import { FileUp, Plus, Trash2, X } from 'lucide-react';
import { type FormEvent, useMemo, useRef, useState } from 'react';
import {
  type CatalogDefect,
  type CatalogProduct,
  type CatalogService,
  type CatalogTerm,
  SERVICE_KINDS,
  type ServiceCondition,
  type ServiceKind,
  SEVERITIES,
  type Severity,
} from '../../../shared/catalog';
import { REQUIREMENTS } from '../../../shared/catalog-door';
import { type CatalogFile, catalogFileBatches, parseCatalogFile, uncertainCounts } from '../../../shared/catalog-file';
import { type CatalogKind, foldText } from '../../../shared/vocab';
import { api, queryClient, useAction, useCatalog, useMe } from '../../api';
import { allCategories, getCategory } from '../../categories';
import { Button, Empty, ErrorBox, Field, IconButton, Input, List, ListRow, Modal, Notice, SearchField, Segmented, Select, SkeletonList, Surface, useConfirm, useToast } from '../../components/ui';

type Kind = 'defects' | 'products' | 'services' | 'terms';
const KINDS: Kind[] = ['defects', 'products', 'services', 'terms'];
const KIND_LABEL: Record<Kind, string> = { defects: 'Mängel', products: 'Produkte', services: 'Leistungen', terms: 'Begriffe' };
const NEW_LABEL: Record<Kind, string> = { defects: 'Neuer Mangel', products: 'Neues Produkt', services: 'Neue Leistung', terms: 'Neuer Begriff' };
const EDIT_LABEL: Record<Kind, string> = { defects: 'Mangel bearbeiten', products: 'Produkt bearbeiten', services: 'Leistung bearbeiten', terms: 'Begriff bearbeiten' };
type Entry = CatalogDefect | CatalogProduct | CatalogTerm | CatalogService;

const artLabel = (k: string) => (k ? getCategory(k).label : 'alle Arten');
const valueText = (v: unknown) => (v === true ? 'ja' : v === false ? 'nein' : Array.isArray(v) ? v.join('/') : String(v ?? ''));
const euro = (n: number) => n.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const list = (s: string) =>
  s
    .split(/[;\n]/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Bedingung einer Leistung als kurzer Text: „Anforderung T30-RS/T90-RS · Flügel 1-flügelig · Obentürschließer ja“ */
function conditionText(cond: ServiceCondition, category: string) {
  const fields = category ? getCategory(category).attributes : allCategories().flatMap((c) => c.attributes);
  return Object.entries(cond ?? {})
    .map(([k, v]) => `${fields.find((f) => f.key === k)?.label ?? k} ${valueText(v)}`)
    .join(' · ');
}

export function CatalogTab() {
  const { data: me } = useMe();
  const canEdit = !!me && ['owner', 'admin'].includes(me.user.role);
  const catalog = useCatalog();
  const [kind, setKind] = useState<Kind>('defects');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ kind: Kind; entry: Entry | null } | null>(null);
  const [loading, setLoading] = useState(false);
  const rows = useMemo(() => {
    const all = (catalog.data?.[kind] ?? []) as Entry[];
    const f = foldText(q);
    if (!f) return all;
    return all.filter((e) => foldText(Object.values(e).flat().filter((v) => typeof v === 'string').join(' ') + ('category' in e && e.category ? ` ${artLabel(e.category)}` : '')).includes(f));
  }, [catalog.data, kind, q]);
  return (
    <Surface>
      <div className="flex flex-col gap-3 border-b border-line px-(--row-px) py-4 lg:flex-row lg:items-center">
        <Segmented value={kind} onChange={setKind} options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k], count: catalog.data?.[k]?.length }))} />
        <SearchField value={q} onChange={setQ} placeholder={`${KIND_LABEL[kind]} durchsuchen`} label={`${KIND_LABEL[kind]} durchsuchen`} className="lg:ml-auto" />
        {canEdit && (
          <div className="flex gap-2 max-sm:[&>*]:flex-1">
            <Button variant="ghost" icon={<FileUp />} onClick={() => setLoading(true)} className="shrink-0">
              Aus Datei laden
            </Button>
            <Button variant="secondary" icon={<Plus />} onClick={() => setEditing({ kind, entry: null })} className="shrink-0">
              {NEW_LABEL[kind]}
            </Button>
          </div>
        )}
      </div>
      <p className="px-(--row-px) pt-4 text-meta text-ink-3">
        {kind === 'defects'
          ? 'Typische Mängel mit Schwere, Maßnahme und Leistungen – erscheinen als Vorschlag, wenn ein Befund ähnlich klingt, und ergeben die Angebotsliste.'
          : kind === 'products'
            ? 'Hersteller und Typen mit Aliassen, Anforderung und Vorgabewerten – im Elementformular füllt ein Tipp Hersteller, Typ und Stammdaten; beim Import und beim Ansagen wird der Typ über die Aliasse erkannt.'
            : kind === 'services'
              ? 'Leistungen mit Preis netto. Die Bedingung auf die Stammdaten entscheidet, welche Position zu einer Tür passt (z. B. Dichtung mit oder ohne Brandschutz).'
              : 'Abkürzungen, die beim Diktat ausgeschrieben werden, z. B. OTS → Obentürschließer.'}
        {!canEdit && ' Ändern können Admins.'}
      </p>
      {catalog.error ? (
        <ErrorBox error={catalog.error} className="m-(--row-px)" />
      ) : catalog.isLoading ? (
        <SkeletonList rows={6} className="px-(--row-px) py-3" />
      ) : !rows.length ? (
        <Empty compact title={q ? 'Nichts gefunden' : `Noch keine ${KIND_LABEL[kind]}`} text={q ? 'Anderen Begriff versuchen.' : canEdit ? 'Lege oben den ersten Eintrag an oder lade eine Katalog-Datei.' : undefined} />
      ) : (
        <List plain aria-label={KIND_LABEL[kind]} className="pt-2 pb-3">
          {rows.map((e) => (
            <ListRow key={e.id} {...rowProps(kind, e)} onClick={canEdit ? () => setEditing({ kind, entry: e }) : undefined} />
          ))}
        </List>
      )}
      {editing && <EntryDialog kind={editing.kind} entry={editing.entry} services={catalog.data?.services ?? []} onClose={() => setEditing(null)} />}
      {loading && <FileDialog services={catalog.data?.services ?? []} onClose={() => setLoading(false)} />}
    </Surface>
  );
}

function rowProps(kind: Kind, e: Entry) {
  if (kind === 'defects') {
    const d = e as CatalogDefect;
    const sv = d.serviceKeys?.length ? `→ ${d.serviceKeys.join(', ')}${d.quantity && d.quantity !== 1 ? ` (× ${String(d.quantity).replace('.', ',')})` : ''}` : '';
    return { title: d.title, subtitle: [SEVERITIES[d.severity], d.measure, sv].filter(Boolean).join(' · '), meta: artLabel(d.category), 'aria-label': d.title };
  }
  if (kind === 'products') {
    const p = e as CatalogProduct;
    const defs = Object.entries(p.defaults)
      .filter(([, v]) => v !== null && v !== '' && v !== false)
      .map(([k, v]) => {
        const a = p.category ? getCategory(p.category).attributes.find((x) => x.key === k) : null;
        return v === true ? (a?.label ?? k) : valueText(v);
      });
    return {
      title: `${p.manufacturer} ${p.model}`,
      subtitle: [
        artLabel(p.category),
        p.requirement,
        ...defs,
        p.approval && `Zulassung ${p.approval}${p.approvalValidUntil ? ` bis ${p.approvalValidUntil.split('-').reverse().join('.')}` : ''}`,
        p.aliases?.length ? `auch: ${p.aliases.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join(' · '),
      'aria-label': `${p.manufacturer} ${p.model}`,
    };
  }
  if (kind === 'services') {
    const s = e as CatalogService;
    return {
      title: `${s.key} · ${s.title}`,
      subtitle: [`${euro(s.price)} je ${s.unit}`, SERVICE_KINDS[s.kind], artLabel(s.category), conditionText(s.condition, s.category)].filter(Boolean).join(' · '),
      meta: euro(s.price),
      'aria-label': `${s.key} ${s.title}`,
    };
  }
  const t = e as CatalogTerm;
  return { title: t.term, subtitle: t.meaning, 'aria-label': t.term };
}

/** Anlegen/Ändern eines Eintrags; Löschen im selben Dialog. */
function EntryDialog({ kind, entry, services, onClose }: { kind: Kind; entry: Entry | null; services: CatalogService[]; onClose: () => void }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [f, setF] = useState<Record<string, unknown>>(() =>
    entry
      ? {
          ...entry,
          synonyms: 'synonyms' in entry ? entry.synonyms.join('; ') : undefined,
          aliases: 'aliases' in entry ? (entry.aliases ?? []).join('; ') : undefined,
        }
      : kind === 'defects'
        ? { title: '', synonyms: '', severity: 'medium', measure: '', category: '', serviceKeys: [], quantity: 1, note: '' }
        : kind === 'products'
          ? { manufacturer: '', model: '', category: '', defaults: {}, approval: '', note: '', aliases: '', approvalValidUntil: '', requirement: '' }
          : kind === 'services'
            ? { key: '', title: '', unit: 'Stk', price: '', kind: 'repair', category: '', condition: {}, note: '' }
            : { term: '', meaning: '' },
  );
  const str = (k: string) => String(f[k] ?? '');
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const body = () => {
    const { id: _id, ...rest } = f;
    if (kind === 'defects') return { ...rest, synonyms: list(str('synonyms')), quantity: Number(String(f.quantity ?? 1).replace(',', '.')) || 1 };
    if (kind === 'products') {
      // nur Felder der gewählten Art behalten, leere weglassen
      const keys = str('category') ? getCategory(str('category')).attributes.map((a) => a.key) : [];
      const defaults = Object.fromEntries(Object.entries((f.defaults ?? {}) as Record<string, unknown>).filter(([k, v]) => keys.includes(k) && k !== 'requirement' && v !== '' && v != null));
      return { ...rest, defaults, aliases: list(str('aliases')), approvalValidUntil: str('approvalValidUntil') || null, requirement: str('requirement') };
    }
    if (kind === 'services') {
      const cond = Object.fromEntries(Object.entries((f.condition ?? {}) as ServiceCondition).filter(([k, v]) => k && v !== '' && !(Array.isArray(v) && !v.length)));
      return { ...rest, price: Number(str('price').replace(',', '.')), condition: cond };
    }
    return rest;
  };
  const save = useAction(
    () => api(entry ? `/catalog/${kind}/${entry.id}` : `/catalog/${kind}`, { method: entry ? 'PATCH' : 'POST', body: body() }),
    () => {
      toast(entry ? 'Gespeichert' : 'Angelegt');
      onClose();
    },
  );
  const del = useAction(
    () => api(`/catalog/${kind}/${entry!.id}`, { method: 'DELETE' }),
    () => {
      toast('Gelöscht');
      onClose();
    },
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(undefined);
  };
  const cats = allCategories();
  const catSelect = (
    <Field label="Elementart">
      {(id) => (
        <Select id={id} value={str('category')} onChange={set('category')}>
          <option value="">Alle Arten</option>
          {cats.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </Select>
      )}
    </Field>
  );
  const attrs = kind === 'products' && str('category') ? getCategory(str('category')).attributes.filter((a) => a.key !== 'requirement') : [];
  const hasRequirement = kind === 'products' && (!str('category') || getCategory(str('category')).attributes.some((a) => a.key === 'requirement'));
  const defaults = (f.defaults ?? {}) as Record<string, string | number | boolean | null>;
  const setDefault = (k: string, v: string | number | boolean | null) => setF((x) => ({ ...x, defaults: { ...((x.defaults as object) ?? {}), [k]: v } }));
  const noteField = (
    <Field label="Notiz" optional className="sm:col-span-2">
      {(id) => <Input id={id} value={str('note')} onChange={set('note')} />}
    </Field>
  );
  return (
    <Modal
      wide={kind === 'services' || kind === 'defects'}
      title={entry ? EDIT_LABEL[kind] : NEW_LABEL[kind]}
      onClose={onClose}
      footer={
        <>
          {entry && (
            <Button
              variant="ghost"
              icon={<Trash2 />}
              className="max-sm:!flex-none sm:mr-auto"
              aria-label="Löschen"
              loading={del.isPending}
              onClick={async () => {
                if (await confirm({ title: 'Eintrag löschen?', text: 'Er wird nicht mehr vorgeschlagen. Vorhandene Elemente und Mängel bleiben unverändert.', confirmLabel: 'Löschen', danger: true }))
                  del.mutate(undefined);
              }}
            >
              <span className="max-sm:hidden">Löschen</span>
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button form="catalog-entry" loading={save.isPending}>
            {entry ? 'Speichern' : 'Anlegen'}
          </Button>
        </>
      }
    >
      {confirmEl}
      <form id="catalog-entry" onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {(save.error || del.error) && <ErrorBox error={save.error ?? del.error} className="sm:col-span-2" />}
        {kind === 'defects' && (
          <>
            <Field label="Bezeichnung" className="sm:col-span-2">
              {(id) => <Input id={id} required autoFocus value={str('title')} onChange={set('title')} placeholder="z. B. Melder verschmutzt" />}
            </Field>
            <Field label="Schwere">
              {(id) => (
                <Select id={id} value={str('severity')} onChange={set('severity')}>
                  {(Object.entries(SEVERITIES) as [Severity, string][]).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {catSelect}
            <Field label="Maßnahme" optional className="sm:col-span-2">
              {(id) => <Input id={id} value={str('measure')} onChange={set('measure')} placeholder="z. B. Melder reinigen oder tauschen" />}
            </Field>
            <Field label="Andere Formulierungen" optional hint="Mit Semikolon trennen – so, wie man es vor Ort sagt" className="sm:col-span-2">
              {(id) => <Input id={id} value={str('synonyms')} onChange={set('synonyms')} placeholder="Verschmutzungsanzeige; Melder staubig" />}
            </Field>
            <ServicePicker
              value={(f.serviceKeys as string[]) ?? []}
              onChange={(v) => setF((x) => ({ ...x, serviceKeys: v }))}
              services={services.filter((s) => !s.category || !str('category') || s.category === str('category'))}
            />
            <Field label="Menge je Mangel" hint="z. B. 1 Stück oder 5 lfm">
              {(id) => <Input id={id} inputMode="decimal" value={str('quantity')} onChange={set('quantity')} className="sm:max-w-32" />}
            </Field>
            {noteField}
          </>
        )}
        {kind === 'products' && (
          <>
            <Field label="Hersteller">
              {(id) => <Input id={id} required autoFocus value={str('manufacturer')} onChange={set('manufacturer')} />}
            </Field>
            <Field label="Typ / Modell">
              {(id) => <Input id={id} required value={str('model')} onChange={set('model')} />}
            </Field>
            {catSelect}
            {hasRequirement && (
              <Field label="Anforderung" optional>
                {(id) => (
                  <Select id={id} value={str('requirement')} onChange={set('requirement')}>
                    <option value="">–</option>
                    {REQUIREMENTS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
            <Field label="Aliasse" optional hint="So, wie der Typ in Listen und Ansagen heißt – mit Semikolon trennen" className="sm:col-span-2">
              {(id) => <Input id={id} value={str('aliases')} onChange={set('aliases')} placeholder="SK32; T30 RS; Premio T30-RS" />}
            </Field>
            <Field label="Zulassung / Prüfzeugnis" optional>
              {(id) => <Input id={id} value={str('approval')} onChange={set('approval')} placeholder="z. B. Z-6.20-1234" />}
            </Field>
            <Field label="Zulassung gültig bis" optional>
              {(id) => <Input id={id} type="date" value={str('approvalValidUntil')} onChange={set('approvalValidUntil')} />}
            </Field>
            {attrs.length > 0 && (
              <fieldset className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-2">
                <legend className="mb-3 text-meta font-medium text-ink-3">Vorgabewerte der Stammdaten</legend>
                {attrs
                  .filter((a) => a.key !== 'approval')
                  .map((a) =>
                    a.type === 'boolean' ? (
                      <label key={a.key} className="flex min-h-10 items-center gap-3 self-end text-body">
                        <input type="checkbox" className="size-4 accent-ink" checked={!!defaults[a.key]} onChange={(e) => setDefault(a.key, e.target.checked)} />
                        {a.label}
                      </label>
                    ) : (
                      <Field key={a.key} label={a.label} optional>
                        {(id) =>
                          a.type === 'select' ? (
                            <Select id={id} value={String(defaults[a.key] ?? '')} onChange={(e) => setDefault(a.key, e.target.value || null)}>
                              <option value="">–</option>
                              {a.options!.map((o) => (
                                <option key={o}>{o}</option>
                              ))}
                            </Select>
                          ) : (
                            <Input
                              id={id}
                              type={a.type === 'number' ? 'number' : a.type === 'date' ? 'date' : 'text'}
                              value={String(defaults[a.key] ?? '')}
                              onChange={(e) => setDefault(a.key, a.type === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
                            />
                          )
                        }
                      </Field>
                    ),
                  )}
              </fieldset>
            )}
            {noteField}
          </>
        )}
        {kind === 'services' && (
          <>
            <Field label="Kürzel" hint="Eindeutig, z. B. Positionsnummer">
              {(id) => <Input id={id} required autoFocus value={str('key')} onChange={set('key')} placeholder="z. B. IS-SCHWELLE" />}
            </Field>
            <Field label="Art der Leistung">
              {(id) => (
                <Select id={id} value={str('kind')} onChange={set('kind')}>
                  {(Object.entries(SERVICE_KINDS) as [ServiceKind, string][]).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Bezeichnung" className="sm:col-span-2">
              {(id) => <Input id={id} required value={str('title')} onChange={set('title')} placeholder="z. B. Bodenschwelle setzen" />}
            </Field>
            <Field label="Preis netto (€)">
              {(id) => <Input id={id} required inputMode="decimal" value={str('price')} onChange={set('price')} placeholder="0,00" />}
            </Field>
            <Field label="Einheit">
              {(id) => <Input id={id} required value={str('unit')} onChange={set('unit')} placeholder="Stk, lfm, h" />}
            </Field>
            {catSelect}
            <ConditionEditor category={str('category')} value={(f.condition ?? {}) as ServiceCondition} onChange={(v) => setF((x) => ({ ...x, condition: v }))} />
            {noteField}
          </>
        )}
        {kind === 'terms' && (
          <>
            <Field label="Begriff / Abkürzung">
              {(id) => <Input id={id} required autoFocus value={str('term')} onChange={set('term')} placeholder="z. B. OTS" />}
            </Field>
            <Field label="Bedeutung">
              {(id) => <Input id={id} required value={str('meaning')} onChange={set('meaning')} placeholder="z. B. Obentürschließer" />}
            </Field>
          </>
        )}
      </form>
    </Modal>
  );
}

/** Leistungen eines Katalog-Mangels: gewählte als Liste, weitere über eine Auswahl. */
function ServicePicker({ value, onChange, services }: { value: string[]; onChange: (v: string[]) => void; services: CatalogService[] }) {
  const byKey = new Map(services.map((s) => [s.key, s]));
  const rest = services.filter((s) => !value.includes(s.key));
  return (
    <div className="flex flex-col gap-2 sm:col-span-2" role="group" aria-label="Leistungen">
      <span className="text-meta font-medium text-ink">Leistungen für die Angebotsliste</span>
      {value.length > 0 && (
        <ul className="flex flex-col gap-1">
          {value.map((k) => {
            const s = byKey.get(k);
            return (
              <li key={k} className="flex min-w-0 items-center gap-2 rounded-md bg-sunken py-1 pr-1 pl-3 text-meta">
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{k}</span>
                  {s ? ` · ${s.title} · ${euro(s.price)}${Object.keys(s.condition ?? {}).length ? ` · nur ${conditionText(s.condition, s.category)}` : ''}` : ' · unbekannt'}
                </span>
                <IconButton label={`${k} entfernen`} size="sm" icon={<X />} onClick={() => onChange(value.filter((x) => x !== k))} />
              </li>
            );
          })}
        </ul>
      )}
      <Select aria-label="Leistung hinzufügen" value="" onChange={(e) => e.target.value && onChange([...value, e.target.value])}>
        <option value="">{services.length ? 'Leistung hinzufügen …' : 'Noch keine Leistungen im Katalog'}</option>
        {rest.map((s) => (
          <option key={s.id} value={s.key}>
            {s.key} · {s.title}
          </option>
        ))}
      </Select>
      <p className="text-caption text-ink-3">Passen mehrere, entscheidet die Bedingung der Leistung (z. B. Anforderung der Tür).</p>
    </div>
  );
}

/** Bedingung einer Leistung: Zeilen „Stammdatum → Wert(e)“; Auswahlfelder mit mehreren Werten. */
function ConditionEditor({ category, value, onChange }: { category: string; value: ServiceCondition; onChange: (v: ServiceCondition) => void }) {
  const fields = (category ? getCategory(category).attributes : []).filter((a) => a.type === 'select' || a.type === 'boolean');
  const used = Object.keys(value);
  const free = fields.filter((a) => !used.includes(a.key));
  const setVal = (k: string, v: ServiceCondition[string] | null) => {
    const next = { ...value };
    if (v == null) delete next[k];
    else next[k] = v;
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-2 sm:col-span-2" role="group" aria-label="Bedingung">
      <span className="text-meta font-medium text-ink">Bedingung auf die Stammdaten</span>
      {!category ? (
        <p className="text-caption text-ink-3">Elementart wählen, um eine Bedingung festzulegen. Ohne Bedingung gilt die Leistung immer.</p>
      ) : (
        <>
          {used.map((k) => {
            const a = fields.find((x) => x.key === k);
            const v = value[k];
            return (
              <div key={k} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 rounded-md bg-sunken py-1.5 pr-1 pl-3">
                <span className="text-meta font-medium">{a?.label ?? k}</span>
                {a?.type === 'boolean' ? (
                  <Select aria-label={`${a.label}: Wert`} className="!w-28" value={v === true ? 'ja' : 'nein'} onChange={(e) => setVal(k, e.target.value === 'ja')}>
                    <option value="ja">ja</option>
                    <option value="nein">nein</option>
                  </Select>
                ) : (
                  <span className="flex flex-wrap gap-x-3 gap-y-1">
                    {(a?.options ?? []).map((o) => {
                      const sel = Array.isArray(v) ? v.includes(o) : v === o;
                      const cur = Array.isArray(v) ? v : v != null && v !== '' ? [String(v)] : [];
                      return (
                        <label key={o} className="flex items-center gap-1.5 text-meta">
                          <input type="checkbox" className="size-4 accent-ink" checked={sel} onChange={(e) => setVal(k, e.target.checked ? [...cur, o] : cur.filter((x) => x !== o))} />
                          {o}
                        </label>
                      );
                    })}
                  </span>
                )}
                <IconButton label={`Bedingung ${a?.label ?? k} entfernen`} size="sm" icon={<X />} onClick={() => setVal(k, null)} className="ml-auto" />
              </div>
            );
          })}
          {free.length > 0 && (
            <Select
              aria-label="Bedingung hinzufügen"
              value=""
              onChange={(e) => {
                const a = fields.find((x) => x.key === e.target.value);
                if (a) setVal(a.key, a.type === 'boolean' ? true : []);
              }}
            >
              <option value="">Bedingung hinzufügen …</option>
              {free.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </Select>
          )}
        </>
      )}
    </div>
  );
}

// ---------- Aus Datei laden ----------
interface BatchResult {
  dryRun: boolean;
  create: string[];
  update: { entry: string; changes: string[] }[];
  unchanged: number;
  errors: { index: number; error: string }[];
}
interface KindSummary {
  create: string[];
  update: { entry: string; changes: string[] }[];
  unchanged: number;
  errors: string[];
}

/** Katalog-Datei laden: Vorschau (neu / geändert / unverändert je Liste), dann übernehmen – POST /catalog/batch. */
function FileDialog({ services, onClose }: { services: CatalogService[]; onClose: () => void }) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState('');
  const [doc, setDoc] = useState<CatalogFile | null>(null);
  const [preview, setPreview] = useState<Partial<Record<CatalogKind, KindSummary>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const run = async (d: CatalogFile, dryRun: boolean) => {
    const out: Partial<Record<CatalogKind, KindSummary>> = {};
    for (const b of catalogFileBatches(d)) {
      const r = await api<BatchResult>('/catalog/batch', { body: { kind: b.kind, items: b.items, dryRun } });
      const s = (out[b.kind] ??= { create: [], update: [], unchanged: 0, errors: [] });
      s.create.push(...r.create);
      s.update.push(...r.update);
      s.unchanged += r.unchanged;
      s.errors.push(...r.errors.map((e) => `${String(b.items[e.index]?.title ?? b.items[e.index]?.model ?? b.items[e.index]?.key ?? b.items[e.index]?.term ?? `Eintrag ${e.index + 1}`)}: ${e.error}`));
    }
    return out;
  };

  const onFile = async (file: File) => {
    setError(null);
    setPreview(null);
    setDoc(null);
    setName(file.name);
    setBusy(true);
    try {
      const d = parseCatalogFile(await file.text());
      setDoc(d);
      setPreview(await run(d, true));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!doc) return;
    setBusy(true);
    setError(null);
    try {
      const r = await run(doc, false);
      await queryClient.invalidateQueries({ queryKey: ['catalog'] });
      const n = Object.values(r).reduce((a, s) => a + s.create.length + s.update.length, 0);
      toast(`Katalog übernommen: ${n} ${n === 1 ? 'Eintrag' : 'Einträge'} neu oder geändert`);
      onClose();
    } catch (e) {
      setError(e);
      setBusy(false);
    }
  };

  // Leistungen, auf die Mängel verweisen, die weder im Katalog noch in der Datei stehen
  const missingServices = useMemo(() => {
    if (!doc) return [];
    const known = new Set([...services.map((s) => foldText(s.key)), ...(doc.services ?? []).map((s) => foldText(String(s.key ?? '')))]);
    return [...new Set((doc.defects ?? []).flatMap((d) => ((d.serviceKeys as string[] | undefined) ?? []).filter((k) => !known.has(foldText(k)))))];
  }, [doc, services]);
  const uncertain = doc ? uncertainCounts(doc) : null;
  const changes = preview ? Object.values(preview).reduce((a, s) => a + s.create.length + s.update.length, 0) : 0;
  const errors = preview ? Object.values(preview).reduce((a, s) => a + s.errors.length, 0) : 0;

  return (
    <Modal
      wide
      title="Katalog aus Datei laden"
      description={doc?.titel ?? 'Katalog-Datei (JSON) mit Leistungen, Produkten, Mängeln und Begriffen'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button onClick={apply} loading={busy && !!preview} disabled={!preview || !changes || busy}>
            Übernehmen
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <input ref={input} type="file" accept=".json,application/json" className="sr-only" aria-label="Katalog-Datei wählen" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" icon={<FileUp />} onClick={() => input.current?.click()} loading={busy && !preview}>
            {name ? 'Andere Datei' : 'Datei wählen'}
          </Button>
          {name && <span className="min-w-0 truncate text-meta text-ink-3">{name}</span>}
        </div>
        {error != null && <ErrorBox error={error} />}
        {doc?.hinweis && <p className="text-meta text-ink-3">{doc.hinweis}</p>}
        {preview && (
          <>
            <p className="text-body" aria-live="polite">
              Vorschau: {changes ? `${changes} ${changes === 1 ? 'Eintrag wird' : 'Einträge werden'} angelegt oder geändert.` : 'Nichts zu ändern – alles schon im Katalog.'}
              {errors > 0 && ` ${errors} ${errors === 1 ? 'Eintrag hat' : 'Einträge haben'} Fehler und ${errors === 1 ? 'wird' : 'werden'} übersprungen.`}
            </p>
            <ul className="flex flex-col divide-y divide-line rounded-lg border border-line" aria-label="Vorschau je Liste">
              {(['services', 'products', 'defects', 'terms'] as CatalogKind[])
                .filter((k) => preview[k])
                .map((k) => {
                  const s = preview[k]!;
                  return (
                    <li key={k} className="flex flex-col gap-1 px-4 py-3">
                      <span className="flex flex-wrap items-baseline gap-x-3">
                        <span className="font-medium">{KIND_LABEL[k as Kind]}</span>
                        <span className="text-meta text-ink-3" data-kind={k}>
                          {s.create.length} neu · {s.update.length} geändert · {s.unchanged} unverändert
                          {uncertain?.[k] ? ` · ${uncertain[k]} unsicher` : ''}
                        </span>
                      </span>
                      {s.create.length > 0 && <span className="text-meta break-words text-ink-2">Neu: {short(s.create)}</span>}
                      {s.update.length > 0 && <span className="text-meta break-words text-ink-2">Geändert: {short(s.update.map((u) => `${u.entry} (${u.changes.join(', ')})`))}</span>}
                      {s.errors.map((e) => (
                        <span key={e} className="text-meta break-words text-bad">
                          {e}
                        </span>
                      ))}
                    </li>
                  );
                })}
            </ul>
            {uncertain && uncertain.products + uncertain.defects + uncertain.services > 0 && (
              <Notice tone="warn" title="Unsichere Einträge">
                Einträge mit der Notiz „Unsicher: …“ sind Deutungen oder offene Fragen – nach dem Laden prüfen.
              </Notice>
            )}
            {missingServices.length > 0 && (
              <Notice tone="warn" title="Leistungen fehlen">
                Mängel verweisen auf Leistungen, die es nicht gibt: {missingServices.join(', ')}
              </Notice>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

const short = (xs: string[], n = 6) => (xs.length > n ? `${xs.slice(0, n).join(', ')} und ${xs.length - n} weitere` : xs.join(', '));

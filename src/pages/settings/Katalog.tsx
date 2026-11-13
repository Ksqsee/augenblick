// Einstellungen → Katalog (v5 Paket P): drei schlichte Listen – typische Mängel, Produkte (Hersteller/Typ mit Vorgaben),
// Begriffe. Lesen ab Prüfer, Anlegen/Ändern/Löschen nur Admins (Server prüft, worker/catalog.ts).
import { Plus, Trash2 } from 'lucide-react';
import { type FormEvent, useMemo, useState } from 'react';
import { type CatalogDefect, type CatalogProduct, type CatalogTerm, SEVERITIES, type Severity } from '../../../shared/catalog';
import { foldText } from '../../../shared/vocab';
import { api, useAction, useCatalog, useMe } from '../../api';
import { allCategories, getCategory } from '../../categories';
import { Button, Empty, ErrorBox, Field, Input, List, ListRow, Modal, SearchField, Segmented, Select, SkeletonList, Surface, useConfirm, useToast } from '../../components/ui';

type Kind = 'defects' | 'products' | 'terms';
const KIND_LABEL: Record<Kind, string> = { defects: 'Mängel', products: 'Produkte', terms: 'Begriffe' };
const NEW_LABEL: Record<Kind, string> = { defects: 'Neuer Mangel', products: 'Neues Produkt', terms: 'Neuer Begriff' };
const EDIT_LABEL: Record<Kind, string> = { defects: 'Mangel bearbeiten', products: 'Produkt bearbeiten', terms: 'Begriff bearbeiten' };
type Entry = CatalogDefect | CatalogProduct | CatalogTerm;

const artLabel = (k: string) => (k ? getCategory(k).label : 'alle Arten');
const valueText = (v: unknown) => (v === true ? 'ja' : v === false ? 'nein' : String(v ?? ''));

export function CatalogTab() {
  const { data: me } = useMe();
  const canEdit = !!me && ['owner', 'admin'].includes(me.user.role);
  const catalog = useCatalog();
  const [kind, setKind] = useState<Kind>('defects');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<{ kind: Kind; entry: Entry | null } | null>(null);
  const rows = useMemo(() => {
    const all = (catalog.data?.[kind] ?? []) as Entry[];
    const f = foldText(q);
    if (!f) return all;
    return all.filter((e) => foldText(Object.values(e).flat().filter((v) => typeof v === 'string').join(' ') + ('category' in e && e.category ? ` ${artLabel(e.category)}` : '')).includes(f));
  }, [catalog.data, kind, q]);
  return (
    <Surface>
      <div className="flex flex-col gap-3 border-b border-line px-(--row-px) py-4 sm:flex-row sm:items-center">
        <Segmented
          value={kind}
          onChange={setKind}
          options={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ value: k, label: KIND_LABEL[k], count: catalog.data?.[k].length }))}
        />
        <SearchField value={q} onChange={setQ} placeholder={`${KIND_LABEL[kind]} durchsuchen`} label={`${KIND_LABEL[kind]} durchsuchen`} className="sm:ml-auto" />
        {canEdit && (
          <Button variant="secondary" icon={<Plus />} onClick={() => setEditing({ kind, entry: null })} className="shrink-0">
            {NEW_LABEL[kind]}
          </Button>
        )}
      </div>
      <p className="px-(--row-px) pt-4 text-meta text-ink-3">
        {kind === 'defects'
          ? 'Typische Mängel mit Schwere und Maßnahme – erscheinen als Vorschlag, wenn ein Befund ähnlich klingt.'
          : kind === 'products'
            ? 'Hersteller und Typen mit Vorgabewerten – im Elementformular füllt ein Tipp Hersteller, Typ und Stammdaten.'
            : 'Abkürzungen, die beim Diktat ausgeschrieben werden, z. B. OTS → Obentürschließer.'}
        {!canEdit && ' Ändern können Admins.'}
      </p>
      {catalog.error ? (
        <ErrorBox error={catalog.error} className="m-(--row-px)" />
      ) : catalog.isLoading ? (
        <SkeletonList rows={6} className="px-(--row-px) py-3" />
      ) : !rows.length ? (
        <Empty compact title={q ? 'Nichts gefunden' : `Noch keine ${KIND_LABEL[kind]}`} text={q ? 'Anderen Begriff versuchen.' : canEdit ? 'Lege oben den ersten Eintrag an.' : undefined} />
      ) : (
        <List plain aria-label={KIND_LABEL[kind]} className="pt-2 pb-3">
          {rows.map((e) => (
            <ListRow key={e.id} {...rowProps(kind, e)} onClick={canEdit ? () => setEditing({ kind, entry: e }) : undefined} />
          ))}
        </List>
      )}
      {editing && <EntryDialog kind={editing.kind} entry={editing.entry} onClose={() => setEditing(null)} />}
    </Surface>
  );
}

function rowProps(kind: Kind, e: Entry) {
  if (kind === 'defects') {
    const d = e as CatalogDefect;
    return { title: d.title, subtitle: [SEVERITIES[d.severity], d.measure].filter(Boolean).join(' · '), meta: artLabel(d.category), 'aria-label': d.title };
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
      subtitle: [artLabel(p.category), ...defs, p.approval && `Zulassung ${p.approval}`].filter(Boolean).join(' · '),
      'aria-label': `${p.manufacturer} ${p.model}`,
    };
  }
  const t = e as CatalogTerm;
  return { title: t.term, subtitle: t.meaning, 'aria-label': t.term };
}

/** Anlegen/Ändern eines Eintrags; Löschen im selben Dialog. */
function EntryDialog({ kind, entry, onClose }: { kind: Kind; entry: Entry | null; onClose: () => void }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [f, setF] = useState<Record<string, unknown>>(() =>
    entry
      ? { ...entry, synonyms: 'synonyms' in entry ? entry.synonyms.join('; ') : undefined }
      : kind === 'defects'
        ? { title: '', synonyms: '', severity: 'medium', measure: '', category: '' }
        : kind === 'products'
          ? { manufacturer: '', model: '', category: '', defaults: {}, approval: '', note: '' }
          : { term: '', meaning: '' },
  );
  const str = (k: string) => String(f[k] ?? '');
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const body = () => {
    const { id: _id, ...rest } = f;
    if (kind === 'defects')
      return {
        ...rest,
        synonyms: str('synonyms')
          .split(/[;\n]/)
          .map((x) => x.trim())
          .filter(Boolean),
      };
    if (kind === 'products') {
      // nur Felder der gewählten Art behalten, leere weglassen
      const keys = str('category') ? getCategory(str('category')).attributes.map((a) => a.key) : [];
      const defaults = Object.fromEntries(Object.entries((f.defaults ?? {}) as Record<string, unknown>).filter(([k, v]) => keys.includes(k) && v !== '' && v != null));
      return { ...rest, defaults };
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
  const attrs = kind === 'products' && str('category') ? getCategory(str('category')).attributes : [];
  const defaults = (f.defaults ?? {}) as Record<string, string | number | boolean | null>;
  const setDefault = (k: string, v: string | number | boolean | null) => setF((x) => ({ ...x, defaults: { ...((x.defaults as object) ?? {}), [k]: v } }));
  return (
    <Modal
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
            <Field label="Zulassung / Prüfzeugnis" optional>
              {(id) => <Input id={id} value={str('approval')} onChange={set('approval')} placeholder="z. B. Z-6.20-1234" />}
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
            <Field label="Notiz" optional className="sm:col-span-2">
              {(id) => <Input id={id} value={str('note')} onChange={set('note')} />}
            </Field>
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

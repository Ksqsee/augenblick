// Einstellungen → Prüfvorlagen: Prüfpunkte und Intervalle je Elementart und Prüfart, eigene Elementarten.
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronRight, Copy, Plus, RotateCcw, X } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { type AttributeField, CATEGORY_COLORS, type Checkpoint } from '../../../shared/catalog';
import { api, type CategoryInfo, type EffectiveSchedule, useAction, useCategories } from '../../api';
import { CategoryIcon, COLOR_CLASSES } from '../../components/CategoryIcon';
import { Badge, Button, ErrorBox, Field, IconButton, Input, Modal, PageSkeleton, Segmented, Select, SectionHeader, useConfirm, useToast } from '../../components/ui';

export function TemplatesTab() {
  const { data, isLoading, error, refetch } = useCategories();
  const [open, setOpen] = useState<string | null>(null);
  const [editType, setEditType] = useState<Partial<CategoryInfo> | null>(null);
  if (isLoading) return <PageSkeleton />;
  if (error || !data) return <ErrorBox error={error} onRetry={() => refetch()} />;
  const variant = (t: CategoryInfo) =>
    setEditType({
      label: `${t.label} (Variante)`,
      plural: `${t.plural} (Variante)`,
      norm: t.norm,
      intervalMonths: t.intervalMonths,
      checkpoints: t.checkpoints,
      attributes: t.attributes,
      maintenance: t.maintenance,
      color: t.color ?? 'slate',
      base: t.key,
    });
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-2xl">
          <SectionHeader title="Elementarten" count={data.length} className="mb-1" />
          <p className="text-meta text-ink-3">Prüfpunkte und Intervalle je Prüfart anpassen oder eigene Arten anlegen (z. B. Rauchschutzvorhänge). Änderungen gelten für neue Prüfungen.</p>
        </div>
        <Button icon={<Plus />} onClick={() => setEditType({})}>
          Eigene Elementart
        </Button>
      </div>
      {editType && <CategoryEditor initial={editType} onClose={() => setEditType(null)} />}
      <ul className="divide-y divide-line overflow-hidden rounded-xl bg-surface shadow-card">
        {data.map((t) => {
          const isOpen = open === t.key;
          return (
            <li key={t.key}>
              <div className={clsx('flex items-center gap-1 pr-2 transition-colors', !isOpen && 'hover:bg-hover')}>
                <button
                  type="button"
                  className="flex min-h-14 min-w-0 flex-1 items-center gap-3 py-2.5 pl-4 text-left"
                  onClick={() => setOpen(isOpen ? null : t.key)}
                  aria-expanded={isOpen}
                >
                  <ChevronRight className={clsx('size-4 shrink-0 text-ink-4 transition-transform', isOpen && 'rotate-90')} />
                  <CategoryIcon category={t.key} size="sm" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-body font-medium">
                      <span className="truncate">{t.label}</span>
                      <span className="shrink-0 font-mono text-caption font-normal text-ink-3">{t.prefix}</span>
                    </span>
                    <span className="mt-0.5 block truncate text-meta text-ink-3">
                      {t.schedulesEffective.map((s) => `${s.label} · ${s.intervalMonths} Mon.`).join('  ·  ')}
                      {t.norm && ` · ${t.norm}`}
                    </span>
                  </span>
                </button>
                {t.custom ? (
                  <Badge tone="info" className="max-sm:hidden">
                    Eigene Art
                  </Badge>
                ) : t.customized ? (
                  <Badge variant="outline" className="max-sm:hidden">
                    Angepasst
                  </Badge>
                ) : null}
                <IconButton label={`${t.label} als Variante kopieren`} icon={<Copy />} onClick={() => variant(t)} />
                {t.custom && (
                  <Button size="sm" variant="secondary" onClick={() => setEditType(t)}>
                    Bearbeiten
                  </Button>
                )}
              </div>
              {isOpen && <ScheduleTemplates category={t} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function ScheduleTemplates({ category }: { category: CategoryInfo }) {
  const [key, setKey] = useState(category.schedulesEffective[0].key);
  const sched = category.schedulesEffective.find((s) => s.key === key) ?? category.schedulesEffective[0];
  return (
    <div className="animate-in border-t border-line bg-canvas/60 px-4 py-5 sm:px-5 sm:pl-[3.75rem]">
      {category.schedulesEffective.length > 1 && (
        <Segmented className="mb-4" value={key} onChange={setKey} options={category.schedulesEffective.map((s) => ({ value: s.key, label: s.label }))} />
      )}
      <TemplateEditor key={`${category.key}:${sched.key}`} category={category.key} schedule={sched} />
    </div>
  );
}

function CheckpointList({ items, onChange }: { items: Checkpoint[]; onChange: (v: Checkpoint[]) => void }) {
  const move = (i: number, d: number) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <>
      <ol className="flex flex-col gap-2">
        {items.map((cp, i) => (
          <li key={cp.id} className="flex items-center gap-1">
            <span className="w-6 shrink-0 pr-1 text-right text-caption text-ink-3 tabular-nums">{i + 1}</span>
            <Input value={cp.label} aria-label={`Prüfpunkt ${i + 1}`} onChange={(e) => onChange(items.map((x) => (x.id === cp.id ? { ...x, label: e.target.value } : x)))} />
            <IconButton label="Nach oben" size="sm" icon={<ArrowUp />} disabled={i === 0} onClick={() => move(i, -1)} className="max-sm:hidden" />
            <IconButton label="Nach unten" size="sm" icon={<ArrowDown />} disabled={i === items.length - 1} onClick={() => move(i, 1)} className="max-sm:hidden" />
            <IconButton label="Entfernen" size="sm" icon={<X />} onClick={() => onChange(items.filter((x) => x.id !== cp.id))} />
          </li>
        ))}
      </ol>
      <Button className="mt-3 ml-7" type="button" variant="ghost" size="sm" icon={<Plus />} onClick={() => onChange([...items, { id: `c${Date.now().toString(36)}`, label: '' }])}>
        Prüfpunkt
      </Button>
    </>
  );
}

function TemplateEditor({ category, schedule }: { category: string; schedule: EffectiveSchedule }) {
  const toast = useToast();
  const [items, setItems] = useState<Checkpoint[]>(schedule.checkpoints);
  const [interval, setIntervalMonths] = useState(schedule.intervalMonths);
  const qs = `?schedule=${schedule.key}`;
  const save = useAction(
    () =>
      api(`/templates/${category}${qs}`, {
        method: 'PUT',
        body: { intervalMonths: interval, checkpoints: items.filter((i) => i.label.trim()).map((i) => ({ ...i, label: i.label.trim() })) },
      }),
    () => toast('Vorlage gespeichert'),
  );
  const reset = useAction(() => api(`/templates/${category}${qs}`, { method: 'DELETE' }), () => toast('Auf Standard zurückgesetzt'));
  return (
    <div className="flex flex-col gap-4">
      {(save.error || reset.error) && <ErrorBox error={save.error ?? reset.error} />}
      <Field label="Prüfintervall (Monate)" className="max-w-48">
        {(id) => <Input id={id} type="number" min={1} max={240} value={interval} onChange={(e) => setIntervalMonths(Number(e.target.value))} />}
      </Field>
      <div>
        <p className="mb-2 text-meta font-medium text-ink-2">Prüfpunkte</p>
        <CheckpointList items={items} onChange={setItems} />
      </div>
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        {schedule.customized && (
          <Button variant="ghost" icon={<RotateCcw />} loading={reset.isPending} onClick={() => reset.mutate(undefined)}>
            Auf Standard zurücksetzen
          </Button>
        )}
        <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Vorlage speichern
        </Button>
      </div>
    </div>
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || `f${Date.now().toString(36)}`;

function CategoryEditor({ initial, onClose }: { initial: Partial<CategoryInfo>; onClose: () => void }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const editing = !!initial.key && !!initial.custom;
  const [f, setF] = useState({
    label: initial.label ?? '',
    plural: initial.plural ?? '',
    prefix: editing ? (initial.prefix ?? '') : '',
    norm: initial.norm ?? '',
    intervalMonths: initial.intervalMonths ?? 12,
    color: initial.color ?? 'slate',
  });
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(initial.checkpoints?.length ? initial.checkpoints : [{ id: 'p1', label: '' }]);
  const [attributes, setAttributes] = useState<AttributeField[]>(initial.attributes ?? []);
  const [maintenance, setMaintenance] = useState<{ key: string; label: string }[]>(initial.maintenance ?? []);
  const body = () => ({
    ...f,
    checkpoints: checkpoints.filter((c) => c.label.trim()).map((c) => ({ ...c, label: c.label.trim() })),
    attributes: attributes.filter((a) => a.label.trim()).map((a) => ({ ...a, key: a.key || slug(a.label), options: a.type === 'select' ? a.options : undefined })),
    maintenance: maintenance.filter((m) => m.label.trim()).map((m) => ({ ...m, key: m.key || slug(m.label) })),
    base: initial.base ?? null,
  });
  const save = useAction(
    () => (editing ? api(`/categories/${initial.key}`, { method: 'PATCH', body: body() }) : api('/categories', { body: body() })),
    () => {
      toast(editing ? 'Gespeichert' : 'Elementart angelegt');
      onClose();
    },
  );
  const del = useAction(
    () => api(`/categories/${initial.key}`, { method: 'DELETE' }),
    () => {
      toast('Elementart gelöscht');
      onClose();
    },
  );
  const sec = (title: string, hint: string, children: ReactNode) => (
    <div className="border-t border-line pt-4">
      <p className="text-meta font-semibold text-ink-2">{title}</p>
      <p className="mb-3 text-caption text-ink-3">{hint}</p>
      {children}
    </div>
  );
  return (
    <Modal
      size="lg"
      title={editing ? `${initial.label} bearbeiten` : initial.base ? 'Variante anlegen' : 'Eigene Elementart'}
      onClose={onClose}
      footer={
        <>
          {editing && (
            <Button
              variant="ghost"
              className="text-bad hover:bg-bad-soft hover:text-bad sm:mr-auto"
              onClick={async () => {
                if (await confirm({ title: 'Elementart löschen?', text: 'Nur möglich, solange keine Elemente dieser Art existieren.', confirmLabel: 'Löschen', danger: true })) del.mutate(undefined);
              }}
            >
              Löschen
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Speichern
          </Button>
        </>
      }
    >
      {confirmEl}
      <div className="flex flex-col gap-4">
        {(save.error || del.error) && <ErrorBox error={save.error ?? del.error} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Bezeichnung">{(id) => <Input id={id} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="z. B. Rauchschutzvorhang" />}</Field>
          <Field label="Mehrzahl">{(id) => <Input id={id} value={f.plural} onChange={(e) => setF({ ...f, plural: e.target.value })} placeholder="z. B. Rauchschutzvorhänge" />}</Field>
          <Field label="Code-Präfix" hint="2–5 Zeichen, z. B. RSV">
            {(id) => <Input id={id} value={f.prefix} maxLength={5} className="font-mono uppercase" onChange={(e) => setF({ ...f, prefix: e.target.value.toUpperCase() })} />}
          </Field>
          <Field label="Prüfintervall (Monate)">{(id) => <Input id={id} type="number" min={1} max={240} value={f.intervalMonths} onChange={(e) => setF({ ...f, intervalMonths: Number(e.target.value) })} />}</Field>
          <Field label="Norm / Grundlage" optional className="sm:col-span-2">
            {(id) => <Input id={id} value={f.norm} onChange={(e) => setF({ ...f, norm: e.target.value })} placeholder="z. B. DIN EN 12101-1" />}
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-2 text-meta font-medium text-ink-2">Farbe des Symbols</p>
            <div className="flex flex-wrap gap-2">
              {CATEGORY_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-label={c}
                  aria-pressed={f.color === c}
                  onClick={() => setF({ ...f, color: c })}
                  className={clsx('size-8 rounded-lg', COLOR_CLASSES[c], f.color === c && 'ring-2 ring-ink ring-offset-2')}
                />
              ))}
            </div>
          </div>
        </div>
        {sec('Prüfpunkte', 'Werden bei jeder Prüfung abgefragt.', <CheckpointList items={checkpoints} onChange={setCheckpoints} />)}
        {sec(
          'Stammdatenfelder',
          'Zusätzliche Angaben am Element, z. B. Baujahr oder Antrieb.',
          <div className="flex flex-col gap-2">
            {attributes.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input className="min-w-40 flex-1" aria-label="Feldname" placeholder="Feldname" value={a.label} onChange={(e) => setAttributes(attributes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Select aria-label="Feldtyp" className="!w-36" value={a.type ?? 'text'} onChange={(e) => setAttributes(attributes.map((x, j) => (j === i ? { ...x, type: e.target.value as AttributeField['type'] } : x)))}>
                  <option value="text">Text</option>
                  <option value="number">Zahl</option>
                  <option value="date">Datum</option>
                  <option value="boolean">Ja/Nein</option>
                  <option value="select">Auswahl</option>
                </Select>
                {a.type === 'select' && (
                  <Input
                    className="min-w-48 flex-1"
                    aria-label="Optionen"
                    placeholder="Optionen, durch Komma getrennt"
                    value={(a.options ?? []).join(', ')}
                    onChange={(e) => setAttributes(attributes.map((x, j) => (j === i ? { ...x, options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) } : x)))}
                  />
                )}
                <IconButton label="Feld entfernen" size="sm" icon={<X />} onClick={() => setAttributes(attributes.filter((_, j) => j !== i))} />
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" className="self-start" icon={<Plus />} onClick={() => setAttributes([...attributes, { key: '', label: '', type: 'text' }])}>
              Feld
            </Button>
          </div>,
        )}
        {sec(
          'Wartungsarbeiten',
          'Zum Abhaken während der Prüfung.',
          <div className="flex flex-col gap-2">
            {maintenance.map((m, i) => (
              <div key={i} className="flex items-center gap-2">
                <Input aria-label="Wartungsarbeit" placeholder="z. B. Antrieb geschmiert" value={m.label} onChange={(e) => setMaintenance(maintenance.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <IconButton label="Entfernen" size="sm" icon={<X />} onClick={() => setMaintenance(maintenance.filter((_, j) => j !== i))} />
              </div>
            ))}
            <Button type="button" variant="ghost" size="sm" className="self-start" icon={<Plus />} onClick={() => setMaintenance([...maintenance, { key: '', label: '' }])}>
              Arbeit
            </Button>
          </div>,
        )}
      </div>
    </Modal>
  );
}

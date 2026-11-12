// Einstellungen → Aufgaben: Labels und SLA-Fristen je Priorität.
import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { CATEGORY_COLORS } from '../../../shared/catalog';
import { api, type SlaPolicies, useAction, useSla, useTaskLabels } from '../../api';
import { COLOR_CLASSES } from '../../components/CategoryIcon';
import { SettingsSection } from '../../components/admin';
import { Button, ErrorBox, IconButton, Input, Skeleton, Surface, useConfirm, useToast } from '../../components/ui';

export function TasksTab() {
  return (
    <Surface>
      <LabelsSection />
      <SlaSection />
    </Surface>
  );
}

function LabelsSection() {
  const { data, isLoading } = useTaskLabels();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>('blue');
  const add = useAction(
    () => api('/tasks/labels', { body: { name, color } }),
    () => {
      setName('');
      toast('Label angelegt');
    },
  );
  const del = useAction((id: string) => api(`/tasks/labels/${id}`, { method: 'DELETE' }), () => toast('Label gelöscht'));
  return (
    <SettingsSection title="Labels" description="Zum Gruppieren und Filtern von Aufgaben, z. B. „Dringend“ oder „Elektro“.">
      {confirmEl}
      {(add.error || del.error) && <ErrorBox error={add.error ?? del.error} />}
      {isLoading ? (
        <Skeleton className="h-20 w-full" />
      ) : !data?.length ? (
        <p className="text-body text-ink-2">Noch keine Labels. Lege unten das erste an.</p>
      ) : (
        <ul className="-my-1 divide-y divide-line">
          {data.map((l) => (
            <li key={l.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              <span className="flex min-w-0 items-center gap-2 text-body">
                <LabelDot color={l.color} />
                <span className="truncate">{l.name}</span>
              </span>
              <span className="flex-1 text-right text-meta text-ink-3 tabular-nums">
                {l.used} {l.used === 1 ? 'Aufgabe' : 'Aufgaben'}
              </span>
              <IconButton
                label={`${l.name} löschen`}
                icon={<Trash2 />}
                onClick={async () => {
                  if (await confirm({ title: `Label „${l.name}“ löschen?`, text: 'Es wird von allen Aufgaben entfernt.', confirmLabel: 'Löschen', danger: true })) del.mutate(l.id);
                }}
              />
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex flex-col gap-3 border-t border-line pt-4 sm:flex-row sm:items-center"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate(undefined);
        }}
      >
        <Input className="sm:flex-1" aria-label="Neues Label" placeholder="Neues Label" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Farbe">
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-label={c}
              aria-checked={color === c}
              onClick={() => setColor(c)}
              className={clsx('grid size-8 place-items-center rounded-md transition-colors', color === c ? 'bg-selected' : 'hover:bg-hover')}
            >
              <LabelDot color={c} size="lg" />
            </button>
          ))}
        </div>
        <Button variant="secondary" icon={<Plus />} loading={add.isPending} disabled={!name.trim()}>
          Hinzufügen
        </Button>
      </form>
    </SettingsSection>
  );
}

/** Farbe eines Labels nur als Punkt (v3) – die Tonfarbe aus COLOR_CLASSES, ohne Fläche. */
export function LabelDot({ color, size = 'sm' }: { color: string; size?: 'sm' | 'lg' }) {
  const text = (COLOR_CLASSES[color] ?? COLOR_CLASSES.slate).split(' ').find((c) => c.startsWith('text-'));
  return <span aria-hidden className={clsx('shrink-0 rounded-full bg-current', text, size === 'lg' ? 'size-3' : 'size-1.5')} />;
}

const PR = { high: 'Hoch', medium: 'Mittel', low: 'Niedrig' } as const;

function SlaSection() {
  const { data } = useSla();
  const toast = useToast();
  const [f, setF] = useState<SlaPolicies | null>(null);
  useEffect(() => {
    if (data) setF(data);
  }, [data]);
  const save = useAction(() => api('/tasks/sla-policies', { method: 'PUT', body: f }), () => toast('SLA-Fristen gespeichert'));
  return (
    <SettingsSection
      title="SLA-Fristen"
      description="Reaktions- und Lösungszeit je Priorität in Stunden. Neue Aufgaben ohne Termin bekommen die Lösungsfrist als Fälligkeit."
      footer={
        <Button loading={save.isPending} disabled={!f} onClick={() => save.mutate(undefined)}>
          Speichern
        </Button>
      }
    >
      {save.error && <ErrorBox error={save.error} />}
      {!f ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <div>
          <div className="grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem] gap-3 border-b border-line pb-2 text-caption font-medium text-ink-3 sm:grid-cols-[minmax(0,1fr)_9rem_9rem]">
            <span>Priorität</span>
            <span>Reaktion (h)</span>
            <span>Lösung (h)</span>
          </div>
          <ul className="divide-y divide-line">
            {(['high', 'medium', 'low'] as const).map((p) => (
              <li key={p} className="grid grid-cols-[minmax(0,1fr)_6.5rem_6.5rem] items-center gap-3 py-2 sm:grid-cols-[minmax(0,1fr)_9rem_9rem]">
                <span className="text-body">{PR[p]}</span>
                <Input
                  type="number"
                  min={1}
                  aria-label={`Reaktion ${PR[p]}`}
                  value={f[p].responseHours}
                  onChange={(e) => setF({ ...f, [p]: { ...f[p], responseHours: Number(e.target.value) } })}
                  className="h-10 tabular-nums sm:h-9"
                />
                <Input
                  type="number"
                  min={1}
                  aria-label={`Lösung ${PR[p]}`}
                  value={f[p].resolutionHours}
                  onChange={(e) => setF({ ...f, [p]: { ...f[p], resolutionHours: Number(e.target.value) } })}
                  className="h-10 tabular-nums sm:h-9"
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </SettingsSection>
  );
}

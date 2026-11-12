import { Link2 } from 'lucide-react';
import { useState } from 'react';
import { type Recurrence, RECURRENCES } from '../../../shared/automation';
import { TASK_KINDS, type TaskKind } from '../../../shared/tasks';
import { api, type Task, useAction, useMembers, useSubcontractors } from '../../api';
import { Button, DictateInput, ErrorBox, Field, Input, Modal, Select, Textarea, useToast } from '../ui';
import { AssetCodes, LabelPicker } from './fields';
import { fromDateInput, TASK_PRIO, toDateInput } from './model';

/**
 * Neue Aufgabe anlegen (Modal, Handy = Bottom-Sheet). Bearbeiten passiert direkt im Detailpanel.
 * initial füllt vor, z. B. aus einem Mangel (Mängelbehebung).
 */
export function TaskForm({ initial, onClose, onCreated }: { initial?: Partial<Task>; onClose: () => void; onCreated?: (id: string) => void }) {
  const toast = useToast();
  const members = useMembers();
  const subs = useSubcontractors();
  const [f, setF] = useState({
    title: initial?.title ?? '',
    description: initial?.description ?? '',
    kind: (initial?.kind ?? (initial?.defectId ? 'defect' : 'other')) as TaskKind,
    assetCode: initial?.assetCode ?? '',
    priority: initial?.priority ?? 'medium',
    due: toDateInput(initial?.dueAt ?? null),
    assigneeId: initial?.assigneeId ?? '',
    subcontractorId: initial?.subcontractorId ?? '',
    labels: initial?.labels ?? [],
    recurrence: initial?.recurrence ?? '',
  });
  const save = useAction(
    async () => {
      const code = f.assetCode.trim();
      let assetId: string | null = !code && initial?.assetId && !initial.assetCode ? initial.assetId : null;
      if (code) assetId = code === (initial?.assetCode ?? '') && initial?.assetId ? initial.assetId : (await api<{ id: string }>(`/assets/by-code/${encodeURIComponent(code)}`)).id;
      return api<{ id: string }>('/tasks', {
        body: {
          title: f.title,
          description: f.description,
          kind: f.kind,
          status: 'open',
          priority: f.priority,
          dueAt: fromDateInput(f.due),
          assigneeId: f.assigneeId || null,
          subcontractorId: f.subcontractorId || null,
          assetId,
          defectId: initial?.defectId ?? null,
          propertyId: initial?.propertyId ?? null,
          labels: f.labels,
          recurrence: f.recurrence || null,
        },
      });
    },
    (r) => {
      toast('Aufgabe angelegt');
      onCreated?.(r.id);
      onClose();
    },
  );
  return (
    <Modal
      wide
      title="Neue Aufgabe"
      description={initial?.defectTitle ? `Zum Mangel „${initial.defectTitle}“` : 'Prüfauftrag, Mängelbehebung oder ein sonstiges To-do'}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button form="task-form" loading={save.isPending}>
            Aufgabe anlegen
          </Button>
        </>
      }
    >
      <form
        id="task-form"
        className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        {save.error && <ErrorBox error={save.error} className="sm:col-span-2" />}
        <Field label="Titel" className="sm:col-span-2">
          {(id) => <DictateInput id={id} required autoFocus maxLength={200} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />}
        </Field>
        <Field label="Typ">
          {(id) => (
            <Select id={id} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as TaskKind })}>
              {(Object.keys(TASK_KINDS) as TaskKind[]).map((k) => (
                <option key={k} value={k} disabled={k === 'defect' && !initial?.defectId}>
                  {TASK_KINDS[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Element (Code)" optional={f.kind !== 'inspection'} hint={f.kind === 'inspection' ? 'Pflicht für Prüfaufträge' : undefined}>
          {(id) => (
            <Input
              id={id}
              list="task-asset-codes"
              required={f.kind === 'inspection'}
              value={f.assetCode}
              placeholder="z. B. FL-7K2M"
              onChange={(e) => setF({ ...f, assetCode: e.target.value.toUpperCase() })}
            />
          )}
        </Field>
        <AssetCodes />
        <Field label="Beschreibung" optional className="sm:col-span-2">
          {(id) => <Textarea id={id} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />}
        </Field>
        <Field label="Zuständig">
          {(id) => (
            <Select id={id} value={f.assigneeId} onChange={(e) => setF({ ...f, assigneeId: e.target.value })}>
              <option value="">Niemand</option>
              {members.data?.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Fällig am" hint="Leer = Lösungsfrist laut SLA">
          {(id) => <Input id={id} type="date" value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />}
        </Field>
        <Field label="Priorität">
          {(id) => (
            <Select id={id} value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value as Task['priority'] })}>
              {Object.entries(TASK_PRIO).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Wiederholen" hint="Beim Erledigen entsteht die nächste Aufgabe (Autopilot)">
          {(id) => (
            <Select id={id} value={f.recurrence} onChange={(e) => setF({ ...f, recurrence: e.target.value as Recurrence | '' })}>
              <option value="">Nie</option>
              {Object.entries(RECURRENCES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Subunternehmer" optional>
          {(id) => (
            <Select id={id} value={f.subcontractorId} onChange={(e) => setF({ ...f, subcontractorId: e.target.value })}>
              <option value="">Keiner</option>
              {subs.data?.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.company}
                  {s.trade ? ` · ${s.trade}` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <div className="sm:col-span-2">
          <LabelPicker value={f.labels} onChange={(labels) => setF({ ...f, labels })} />
        </div>
        {f.subcontractorId && (
          <p className="flex items-center gap-1.5 text-caption text-ink-3 sm:col-span-2">
            <Link2 className="size-3.5" /> Den Link für die Firma erzeugst du nach dem Anlegen in der Aufgabe.
          </p>
        )}
      </form>
    </Modal>
  );
}

// Einstellungen → Automatik: Autopilot-Regeln (Stufe je Regel), Zuweisungsregeln für Mängel und Protokoll mit „Rückgängig“.
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type AssignRule, AUTOMATION_MODES, type AutomationKey, type AutomationMode, type SeverityKey } from '../../../shared/automation';
import { api, type AutomationRule, useAction, useAutomationLog, useAutomations, useCategories, useMembers, useSubcontractors } from '../../api';
import { Button, Empty, ErrorBox, IconButton, Input, Segmented, Select, SettingsSection, Skeleton, SkeletonList, useToast } from '../../components/ui';
import { fmtDateTime } from '../../format';

export function AutomationTab() {
  const q = useAutomations();
  if (q.isLoading) return <SkeletonList rows={6} />;
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const assign = q.data.find((r) => r.key === 'assign_defect_tasks');
  return (
    <div>
      <RulesSection rules={q.data} />
      {assign && <AssignSection rule={assign} />}
      <LogSection />
    </div>
  );
}

const MODE_OPTIONS = (Object.keys(AUTOMATION_MODES) as AutomationMode[]).map((m) => ({ value: m, label: AUTOMATION_MODES[m] }));

function RulesSection({ rules }: { rules: AutomationRule[] }) {
  const toast = useToast();
  const set = useAction(
    (v: { key: AutomationKey; mode: AutomationMode }) => api('/automation', { method: 'PUT', body: v }),
    (_, v) => toast(`${rules.find((r) => r.key === v.key)?.title}: ${AUTOMATION_MODES[v.mode]}`),
  );
  return (
    <SettingsSection
      title="Autopilot"
      description="Routine, die Prüfkompass selbst erledigt. „Vorschlagen“ zeigt die Aufgabe auf der Startseite mit einem Knopf, „Automatisch“ führt sie aus und schreibt sie ins Protokoll."
    >
      {set.error && <ErrorBox error={set.error} />}
      <ul className="-my-1 divide-y divide-line">
        {rules.map((r) => (
          <li key={r.key} data-automation={r.key} className="flex flex-col gap-3 py-3 first:pt-0 last:pb-0 md:flex-row md:items-center md:gap-6">
            <div className="min-w-0 flex-1">
              <p className="text-body font-medium text-ink">{r.title}</p>
              <p className="mt-0.5 text-meta text-ink-3">{r.description}</p>
              <p className="mt-1 text-caption text-ink-3">
                {r.lastRunAt ? (
                  <>
                    Zuletzt ausgeführt <span className="tabular-nums">{fmtDateTime(r.lastRunAt)}</span>
                  </>
                ) : (
                  'Noch nicht ausgeführt'
                )}
              </p>
            </div>
            <div role="group" aria-label={`Stufe für ${r.title}`} className="shrink-0">
              <Segmented value={r.mode} options={MODE_OPTIONS} onChange={(mode) => mode !== r.mode && set.mutate({ key: r.key, mode })} />
            </div>
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
}

// Schwere als feste Auswahl (statt Mehrfachauswahl) – deckt die üblichen Fälle ab
const SEVERITY_PRESETS: { key: string; label: string; severities: SeverityKey[] }[] = [
  { key: 'critical', label: 'Kritisch', severities: ['critical'] },
  { key: 'high', label: 'Hoch und kritisch', severities: ['high', 'critical'] },
  { key: 'medium', label: 'Ab mittel', severities: ['medium', 'high', 'critical'] },
  { key: 'all', label: 'Alle', severities: ['low', 'medium', 'high', 'critical'] },
  { key: 'only-high', label: 'Nur hoch', severities: ['high'] },
  { key: 'only-medium', label: 'Nur mittel', severities: ['medium'] },
  { key: 'only-low', label: 'Nur gering', severities: ['low'] },
];
const presetOf = (s: SeverityKey[]) => SEVERITY_PRESETS.find((p) => p.severities.length === s.length && p.severities.every((x) => s.includes(x)))?.key ?? 'high';

const emptyRule = (): AssignRule => ({ id: `n${Math.random().toString(36).slice(2, 10)}`, category: null, severities: ['high', 'critical'], assigneeId: null, subcontractorId: null, days: null });

function AssignSection({ rule }: { rule: AutomationRule }) {
  const toast = useToast();
  const cats = useCategories();
  const members = useMembers();
  const subs = useSubcontractors();
  const [rules, setRules] = useState<AssignRule[]>(rule.config?.rules ?? []);
  useEffect(() => setRules(rule.config?.rules ?? []), [rule.config]);
  const save = useAction(() => api('/automation', { method: 'PUT', body: { key: 'assign_defect_tasks', config: { rules } } }), () => toast('Zuweisungsregeln gespeichert'));
  const upd = (i: number, ch: Partial<AssignRule>) => setRules(rules.map((r, j) => (j === i ? { ...r, ...ch } : r)));
  const people = (members.data?.members ?? []).filter((m) => m.role !== 'viewer');
  const complete = rules.every((r) => r.assigneeId || r.subcontractorId);
  return (
    <SettingsSection
      title="Zuweisungsregeln"
      description="Für „Mängel zuweisen“: Elementart und Schwere bestimmen, wer die Aufgabe bekommt und bis wann. Die erste passende Regel gilt. Ohne passende Regel entsteht die Aufgabe bei hohen und kritischen Mängeln ohne Zuständige mit der Frist laut SLA."
      footer={
        <Button loading={save.isPending} disabled={!complete} onClick={() => save.mutate(undefined)}>
          Regeln speichern
        </Button>
      }
    >
      {save.error && <ErrorBox error={save.error} />}
      {!rules.length ? (
        <Empty compact className="!py-4" title="Noch keine Zuweisungsregeln" text="Zum Beispiel: Brandschutzklappe, kritisch → Firma Lüftungstechnik, 3 Tage." />
      ) : (
        <ul className="-my-1 divide-y divide-line" aria-label="Zuweisungsregeln">
          {rules.map((r, i) => (
            <li key={r.id} data-rule={i} className="grid grid-cols-2 items-end gap-3 py-3 first:pt-0 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_5.5rem_auto]">
              <label className="flex min-w-0 flex-col gap-1 text-caption text-ink-3">
                Elementart
                <Select aria-label={`Elementart Regel ${i + 1}`} value={r.category ?? ''} onChange={(e) => upd(i, { category: e.target.value || null })}>
                  <option value="">Alle Arten</option>
                  {cats.data?.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-caption text-ink-3">
                Schwere
                <Select
                  aria-label={`Schwere Regel ${i + 1}`}
                  value={presetOf(r.severities)}
                  onChange={(e) => upd(i, { severities: SEVERITY_PRESETS.find((p) => p.key === e.target.value)!.severities })}
                >
                  {SEVERITY_PRESETS.map((p) => (
                    <option key={p.key} value={p.key}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="col-span-2 flex min-w-0 flex-col gap-1 text-caption text-ink-3 md:col-span-1">
                Zuständig
                <Select
                  aria-label={`Zuständig Regel ${i + 1}`}
                  value={r.assigneeId ? `u:${r.assigneeId}` : r.subcontractorId ? `s:${r.subcontractorId}` : ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    upd(i, { assigneeId: v.startsWith('u:') ? v.slice(2) : null, subcontractorId: v.startsWith('s:') ? v.slice(2) : null });
                  }}
                >
                  <option value="">Bitte wählen</option>
                  <optgroup label="Personen">
                    {people.map((m) => (
                      <option key={m.id} value={`u:${m.id}`}>
                        {m.name}
                      </option>
                    ))}
                  </optgroup>
                  {!!subs.data?.length && (
                    <optgroup label="Subunternehmer">
                      {subs.data.map((s) => (
                        <option key={s.id} value={`s:${s.id}`}>
                          {s.company}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </Select>
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-caption text-ink-3">
                Frist (Tage)
                <Input
                  type="number"
                  min={1}
                  max={365}
                  inputMode="numeric"
                  placeholder="SLA"
                  aria-label={`Frist in Tagen Regel ${i + 1}`}
                  className="tabular-nums"
                  value={r.days ?? ''}
                  onChange={(e) => upd(i, { days: e.target.value ? Math.max(1, Math.min(365, Math.round(Number(e.target.value)))) : null })}
                />
              </label>
              <div className="flex justify-end">
                <IconButton label={`Regel ${i + 1} entfernen`} icon={<Trash2 />} onClick={() => setRules(rules.filter((_, j) => j !== i))} />
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="border-t border-line pt-4">
        <Button variant="secondary" icon={<Plus />} disabled={rules.length >= 30} onClick={() => setRules([...rules, emptyRule()])}>
          Regel hinzufügen
        </Button>
      </div>
    </SettingsSection>
  );
}

function LogSection() {
  const toast = useToast();
  const q = useAutomationLog(100);
  const undo = useAction(
    (id: string) => api<{ reverted: number; kept: number }>(`/automation/log/${id}/undo`, { method: 'POST', body: {} }),
    (r) => toast(r.kept ? `Rückgängig gemacht – ${r.kept} bereits bearbeitet und behalten` : 'Rückgängig gemacht'),
  );
  return (
    <SettingsSection className="!border-b-0" title="Protokoll" description="Was der Autopilot erledigt hat, neueste zuerst. Rückgängig ist sieben Tage lang möglich.">
      {undo.error && <ErrorBox error={undo.error} />}
      {q.isLoading ? (
        <Skeleton className="h-32 w-full" />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <Empty compact className="!py-4" title="Noch nichts erledigt" text="Sobald eine Regel etwas tut, steht es hier." />
      ) : (
        <ul className="-my-1 divide-y divide-line" aria-label="Autopilot-Protokoll">
          {q.data.map((e) => (
            <li key={e.id} data-log={e.key} className="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:gap-4">
              <div className="min-w-0 flex-1">
                <p className={e.undoneAt ? 'text-body break-words text-ink-3 line-through' : 'text-body break-words text-ink'}>
                  {e.link && !e.undoneAt ? (
                    <Link to={e.link} className="hover:underline">
                      {e.summary}
                    </Link>
                  ) : (
                    e.summary
                  )}
                </p>
                <p className="mt-0.5 text-meta text-ink-3">
                  {e.title} · {e.actorName} · <span className="tabular-nums">{fmtDateTime(e.at)}</span>
                  {e.undoneAt ? ' · rückgängig gemacht' : ''}
                </p>
              </div>
              {e.undoable && (
                <Button variant="ghost" size="sm" className="self-start sm:self-center" loading={undo.isPending && undo.variables === e.id} onClick={() => undo.mutate(e.id)}>
                  Rückgängig
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

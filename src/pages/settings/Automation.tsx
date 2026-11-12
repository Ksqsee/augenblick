// Einstellungen → Automatik: Autopilot-Regeln (Stufe je Regel), Zuweisungsregeln für Mängel und Protokoll mit „Rückgängig“.
// v3: die ruhigste Seite – eine Surface, Regeln als SettingRows, Protokoll als zeitlich geordnete Liste nach Tagen.
import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type AssignRule, AUTOMATION_MODES, type AutomationKey, type AutomationMode, type SeverityKey } from '../../../shared/automation';
import { api, type AutomationRule, useAction, useAutomationLog, useAutomations, useCategories, useMembers, useSubcontractors } from '../../api';
import { DayHeading, fmtTime, groupByDay, SettingRow } from '../../components/admin';
import { Button, ErrorBox, IconButton, Input, Section, Segmented, Select, Skeleton, SkeletonList, Surface, useToast } from '../../components/ui';
import { fmtDateTime } from '../../format';

export function AutomationTab() {
  const q = useAutomations();
  if (q.isLoading) return <SkeletonList rows={6} />;
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  const assign = q.data.find((r) => r.key === 'assign_defect_tasks');
  return (
    <Surface>
      <RulesSection rules={q.data} />
      {assign && <AssignSection rule={assign} />}
      <LogSection />
    </Surface>
  );
}

/** Ein Satz unter dem Abschnittstitel. */
function Lead({ children }: { children: React.ReactNode }) {
  return <p className="-mt-1 mb-2 max-w-2xl text-meta text-ink-2">{children}</p>;
}

const MODE_OPTIONS = (Object.keys(AUTOMATION_MODES) as AutomationMode[]).map((m) => ({ value: m, label: AUTOMATION_MODES[m] }));

function RulesSection({ rules }: { rules: AutomationRule[] }) {
  const toast = useToast();
  const set = useAction(
    (v: { key: AutomationKey; mode: AutomationMode }) => api('/automation', { method: 'PUT', body: v }),
    (_, v) => toast(`${rules.find((r) => r.key === v.key)?.title}: ${AUTOMATION_MODES[v.mode]}`),
  );
  return (
    <Section title="Regeln">
      <Lead>„Vorschlagen“ zeigt die Aufgabe auf der Startseite mit einem Knopf, „Automatisch“ führt sie aus und schreibt sie ins Protokoll.</Lead>
      {set.error && <ErrorBox error={set.error} className="my-2" />}
      <ul className="divide-y divide-line" aria-label="Autopilot-Regeln">
        {rules.map((r) => (
          <li key={r.key} data-automation={r.key} className="py-4 last:pb-0">
            <SettingRow title={r.title} description={r.description} className="md:gap-10">
              <div className="flex flex-col items-start gap-1.5 sm:items-end">
                <div role="group" aria-label={`Stufe für ${r.title}`}>
                  <Segmented value={r.mode} options={MODE_OPTIONS} onChange={(mode) => mode !== r.mode && set.mutate({ key: r.key, mode })} />
                </div>
                <p className="text-caption text-ink-3">
                  {r.lastRunAt ? (
                    <>
                      Zuletzt ausgeführt <span className="tabular-nums">{fmtDateTime(r.lastRunAt)}</span>
                    </>
                  ) : (
                    'Noch nicht ausgeführt'
                  )}
                </p>
              </div>
            </SettingRow>
          </li>
        ))}
      </ul>
    </Section>
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
    <Section title="Zuweisungsregeln">
      <Lead>
        Für „Mängel zuweisen“: Elementart und Schwere bestimmen, wer die Aufgabe bekommt und bis wann. Die erste passende Regel gilt; ohne passende Regel entsteht die Aufgabe bei hohen und
        kritischen Mängeln ohne Zuständige mit der Frist laut SLA.
      </Lead>
      {save.error && <ErrorBox error={save.error} className="my-2" />}
      {!rules.length ? (
        <p className="py-3 text-body text-ink-2">Noch keine Zuweisungsregeln. Zum Beispiel: Brandschutzklappe, kritisch → Firma Lüftungstechnik, 3 Tage.</p>
      ) : (
        <ul className="divide-y divide-line" aria-label="Zuweisungsregeln">
          {rules.map((r, i) => (
            <li key={r.id} data-rule={i} className="grid grid-cols-2 items-end gap-3 py-4 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_5.5rem_auto]">
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
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
        <Button variant="ghost" icon={<Plus />} disabled={rules.length >= 30} onClick={() => setRules([...rules, emptyRule()])}>
          Regel hinzufügen
        </Button>
        <Button loading={save.isPending} disabled={!complete} onClick={() => save.mutate(undefined)}>
          Regeln speichern
        </Button>
      </div>
    </Section>
  );
}

function LogSection() {
  const toast = useToast();
  const q = useAutomationLog(100);
  const undo = useAction(
    (id: string) => api<{ reverted: number; kept: number }>(`/automation/log/${id}/undo`, { method: 'POST', body: {} }),
    (r) => toast(r.kept ? `Rückgängig gemacht – ${r.kept} bereits bearbeitet und behalten` : 'Rückgängig gemacht'),
  );
  const groups = groupByDay(q.data ?? [], (e) => e.at);
  return (
    <Section title="Protokoll" flush>
      <div className="px-(--row-px)">
        <Lead>Was der Autopilot erledigt hat, neueste zuerst. Rückgängig ist sieben Tage lang möglich.</Lead>
        {undo.error && <ErrorBox error={undo.error} className="my-2" />}
      </div>
      {q.isLoading ? (
        <div className="px-(--row-px) py-2">
          <Skeleton className="h-24 w-full" />
        </div>
      ) : q.error ? (
        <div className="px-(--row-px) py-2">
          <ErrorBox error={q.error} onRetry={() => q.refetch()} />
        </div>
      ) : !q.data?.length ? (
        <p className="px-(--row-px) py-3 text-body text-ink-2">Noch nichts erledigt. Sobald eine Regel etwas tut, steht es hier.</p>
      ) : (
        <ul className="pk-list" aria-label="Autopilot-Protokoll">
          {groups.flatMap(([day, rows]) => [
            <DayHeading key={`d-${day}`}>{day}</DayHeading>,
            ...rows.map((e) => {
              const undone = !!e.undoneAt;
              return (
                <li key={e.id} data-log={e.key} className="flex items-start gap-3 px-(--row-px) py-2.5" style={{ '--row-inset': '56px' } as React.CSSProperties}>
                  <span className="w-11 shrink-0 pt-px text-meta text-ink-3 tabular-nums">{fmtTime(e.at)}</span>
                  <div className="min-w-0 flex-1">
                    <p className={clsx('text-body break-words', undone ? 'text-ink-3 line-through decoration-ink-4' : 'text-ink')}>
                      {e.link && !undone ? (
                        <Link to={e.link} className="hover:underline">
                          {e.summary}
                        </Link>
                      ) : (
                        e.summary
                      )}
                    </p>
                    <p className="mt-0.5 text-meta text-ink-3">
                      {e.title} · {e.actorName}
                      {undone ? ' · rückgängig gemacht' : ''}
                    </p>
                  </div>
                  {e.undoable && (
                    <button
                      type="button"
                      disabled={undo.isPending && undo.variables === e.id}
                      onClick={() => undo.mutate(e.id)}
                      className="-my-1.5 min-h-8 shrink-0 text-meta font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
                    >
                      Rückgängig
                    </button>
                  )}
                </li>
              );
            }),
          ])}
        </ul>
      )}
    </Section>
  );
}

// Einstellungen → Automatik: der Autopilot als Ablauf. Oben der Hauptschalter, darunter der Kreislauf als senkrechte
// Folge von sechs nummerierten Schritten (je ein Satz, Stufe, „zuletzt …“), durch eine dünne Tintenlinie verbunden –
// bewusst kein Knoten-Editor. Die Zuweisungsregeln stehen in Schritt 2, das Protokoll darunter. Eine Surface.
import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type AssignRule, AUTOMATION_MODES, type AutomationKey, type AutomationMode, type SeverityKey, weekSummary } from '../../../shared/automation';
import { api, type AutomationRule, useAction, useAutomationLog, useAutomations, useAutopilot, useCategories, useMembers, useSubcontractors } from '../../api';
import { DayHeading, fmtTime, groupByDay } from '../../components/admin';
import { Button, ErrorBox, IconButton, Input, Section, Segmented, Select, Skeleton, SkeletonList, Surface, Switch, useToast } from '../../components/ui';
import { fmtDateTime, fmtRelative } from '../../format';

export function AutomationTab() {
  const q = useAutomations();
  const pilot = useAutopilot();
  if (q.isLoading || pilot.isLoading) return <SkeletonList rows={6} />;
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (pilot.error || !pilot.data) return <ErrorBox error={pilot.error} onRetry={() => pilot.refetch()} />;
  return (
    <Surface>
      <MasterSection enabled={pilot.data.enabled} lastWeek={weekSummary(pilot.data.lastWeek)} />
      <CycleSection steps={q.data} enabled={pilot.data.enabled} />
      <LogSection />
    </Surface>
  );
}

/** Ein Satz unter dem Abschnittstitel. */
function Lead({ children }: { children: React.ReactNode }) {
  return <p className="-mt-1 mb-2 max-w-2xl text-meta text-ink-2">{children}</p>;
}

function MasterSection({ enabled, lastWeek }: { enabled: boolean; lastWeek: string | null }) {
  const toast = useToast();
  const set = useAction(
    (on: boolean) => api('/automation/autopilot', { method: 'PUT', body: { enabled: on } }),
    (_, on) => toast(on ? 'Autopilot an' : 'Autopilot aus'),
  );
  return (
    <section aria-label="Autopilot" className="px-(--row-px) pt-5 pb-6 sm:pt-7">
      {set.error && <ErrorBox error={set.error} className="mb-3" />}
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h2 className="text-h3 text-ink">Autopilot</h2>
          <p className="mt-1 max-w-xl text-body text-ink-2">
            {enabled
              ? 'Dreht den Kreislauf der Brandschutzprüfung von selbst. Ihr prüft vor Ort und entscheidet die Ausnahmen.'
              : 'Ruht. Kein Schritt läuft oder schlägt etwas vor; die Stufen bleiben gemerkt.'}
          </p>
          <p className="mt-2 text-meta text-ink-3">{lastWeek ? <>Letzte 7 Tage: {lastWeek}</> : 'In den letzten 7 Tagen nichts erledigt.'}</p>
        </div>
        <Switch className="shrink-0 items-center gap-3 pt-1" label={enabled ? 'An' : 'Aus'} checked={enabled} disabled={set.isPending} onChange={(v) => set.mutate(v)} />
      </div>
    </section>
  );
}

const MODE_OPTIONS = (Object.keys(AUTOMATION_MODES) as AutomationMode[]).map((m) => ({ value: m, label: AUTOMATION_MODES[m] }));

function CycleSection({ steps, enabled }: { steps: AutomationRule[]; enabled: boolean }) {
  const toast = useToast();
  const set = useAction(
    (v: { key: AutomationKey; mode: AutomationMode }) => api('/automation', { method: 'PUT', body: v }),
    (_, v) => toast(`${steps.find((r) => r.key === v.key)?.title}: ${AUTOMATION_MODES[v.mode]}`),
  );
  return (
    <Section title="Kreislauf">
      <Lead>„Vorschlagen“ legt den Schritt unter „Jetzt“ zur Entscheidung vor, „Automatisch“ führt ihn aus und schreibt ihn ins Protokoll.</Lead>
      {set.error && <ErrorBox error={set.error} className="my-2" />}
      <ol aria-label="Kreislauf" className={clsx('mt-4 transition-opacity', !enabled && 'opacity-60')}>
        {steps.map((r, i) => {
          const last = i === steps.length - 1;
          return (
            <li key={r.key} data-automation={r.key} className="relative grid grid-cols-[28px_minmax(0,1fr)] gap-x-4">
              {/* Nummer und die Linie zum nächsten Schritt */}
              <span aria-hidden className="relative z-10 grid size-7 place-items-center rounded-full border border-ink bg-surface text-caption font-medium text-ink tabular-nums">
                {r.step}
              </span>
              {!last && <span aria-hidden className="absolute top-7 bottom-0 left-[13.5px] w-px bg-ink" />}
              <div className={clsx('min-w-0', last ? 'pb-1' : 'pb-7')}>
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between md:gap-10">
                  <div className="min-w-0 pt-0.5">
                    <h3 className="text-body font-medium text-ink">{r.title}</h3>
                    <p className="mt-0.5 max-w-xl text-meta text-ink-2">{r.description}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-start gap-1.5 md:items-end">
                    <div role="group" aria-label={`Stufe für ${r.title}`}>
                      <Segmented value={r.mode} options={MODE_OPTIONS} onChange={(mode) => mode !== r.mode && set.mutate({ key: r.key, mode })} />
                    </div>
                    <p className="text-caption text-ink-3" title={r.lastRunAt ? fmtDateTime(r.lastRunAt) : undefined}>
                      {!enabled ? 'ruht' : r.lastRunAt ? `zuletzt ${fmtRelative(r.lastRunAt)}` : 'noch nie'}
                    </p>
                  </div>
                </div>
                {r.key === 'assign_defect_tasks' && <AssignRules rule={r} />}
              </div>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 pl-11 text-meta text-ink-3">Danach beginnt der Kreislauf von vorn: Der Nachweis zeigt, was als Nächstes fällig wird.</p>
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

/** Zuweisungsregeln – Teil von Schritt 2 „Zuweisen“. */
function AssignRules({ rule }: { rule: AutomationRule }) {
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
    <div className="mt-4 border-t border-line pt-4">
      <h4 className="text-meta font-medium text-ink-3">Zuweisungsregeln</h4>
      <p className="mt-0.5 mb-1 max-w-2xl text-meta text-ink-2">
        Elementart und Schwere bestimmen, wer die Aufgabe bekommt und bis wann. Die erste passende Regel gilt; ohne passende Regel entsteht sie bei hohen und kritischen Mängeln ohne
        Zuständige mit der Frist laut SLA.
      </p>
      {save.error && <ErrorBox error={save.error} className="my-2" />}
      {!rules.length ? (
        <p className="py-2 text-body text-ink-2">Noch keine Zuweisungsregeln. Zum Beispiel: Brandschutzklappe, kritisch → Firma Lüftungstechnik, 3 Tage.</p>
      ) : (
        <ul className="divide-y divide-line" aria-label="Zuweisungsregeln">
          {rules.map((r, i) => (
            <li key={r.id} data-rule={i} className="grid grid-cols-2 items-end gap-3 py-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.4fr)_5.5rem_auto]">
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
              <label className="col-span-2 flex min-w-0 flex-col gap-1 text-caption text-ink-3 lg:col-span-1">
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
      <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" icon={<Plus />} disabled={rules.length >= 30} onClick={() => setRules([...rules, emptyRule()])}>
          Regel hinzufügen
        </Button>
        <Button variant="secondary" loading={save.isPending} disabled={!complete} onClick={() => save.mutate(undefined)}>
          Regeln speichern
        </Button>
      </div>
    </div>
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
        <p className="px-(--row-px) py-3 text-body text-ink-2">Noch nichts erledigt. Sobald ein Schritt etwas tut, steht es hier.</p>
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

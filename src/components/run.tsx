import { getCategory } from '../categories';
import clsx from 'clsx';
import { Camera, CheckCheck, Loader2, Plus, Sparkles, Trash2, X } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { type Category, type Checkpoint, type CustomKind, INSPECTION_KINDS, SEVERITIES, type Severity } from '../../shared/catalog';
import { type Answer, computeResult, finalResult, isComplete, type ResultOverride } from '../../shared/logic';
import { type DefectDraft, fileUrl, uploadPhoto, useMe } from '../api';
import { defectsLabel, fmtDate, RESULT_META } from '../format';
import { decideKnown, groupKnownDefects, type KnownDecision, knownDecision, type KnownDefect } from '../../shared/carry';
import { CategoryIcon } from './CategoryIcon';
import { Button, Card, DictateInput, Notice, SectionHeader, Switch, Textarea, toneDot, SEVERITY_TONE, useConfirm } from './ui';
import { type CaptureItem, suggestMeasure, suggestSeverity } from '../../shared/smart';
import { CheckpointRow, reveal, revealNextOpen } from './inspect/Checkpoint';
import { RadioChips, ToggleChip } from './inspect/Choice';
import { ReadyList, RunFrame, type RunStep, type SaveState } from './inspect/RunFrame';
import { SignatureSection } from './inspect/Signature';
import { VoicePanel } from './inspect/VoicePanel';

export { AnswerSegment as AnswerButtons } from './inspect/Checkpoint';
export { RunFrame, SaveIndicator, ReadyList, type RunStep, type SaveState } from './inspect/RunFrame';
export { SignatureSection } from './inspect/Signature';

// ---------- Fotos: online → R2, offline → IndexedDB ----------
export interface PhotoStore {
  upload: (file: File) => Promise<string>;
  src: (key: string) => string;
}
const onlinePhotos: PhotoStore = { upload: uploadPhoto, src: fileUrl };
export const PhotoCtx = createContext<PhotoStore>(onlinePhotos);

/** Zu einer Stelle der Seite springen (Element-ID). */
export const jumpTo = (id: string) => reveal(document.getElementById(id), 'start');

export interface DefectLike {
  title: string;
  note: string;
  measure?: string;
  severity: Severity;
  photoKey?: string;
}

/** Vorschläge aus dem Text: passende Maßnahme und Schweregrad mit einem Tipp übernehmen. */
function SmartHints<T extends DefectLike>({ defect, onChange }: { defect: T; onChange: (d: T) => void }) {
  const text = `${defect.title} ${defect.note}`.trim();
  if (text.length < 4) return null;
  const measure = !defect.measure?.trim() ? suggestMeasure(text) : '';
  const sev = suggestSeverity(text);
  const sevHint = sev !== defect.severity && (sev === 'critical' || sev === 'high') ? sev : null;
  if (!measure && !sevHint) return null;
  const chip = 'inline-flex min-h-8 items-center gap-1.5 rounded-lg bg-info-soft px-2.5 py-1 text-left text-caption font-medium text-info transition-colors hover:bg-info-line/60';
  return (
    <div className="flex flex-wrap gap-1.5" aria-label="Vorschläge">
      {measure && (
        <button type="button" onClick={() => onChange({ ...defect, measure })} className={chip}>
          <Sparkles className="size-3.5 shrink-0" /> Maßnahme: {measure}
        </button>
      )}
      {sevHint && (
        <button type="button" onClick={() => onChange({ ...defect, severity: sevHint })} className={chip}>
          <Sparkles className="size-3.5 shrink-0" /> Als „{SEVERITIES[sevHint]}“ einstufen
        </button>
      )}
    </div>
  );
}

const SEVERITY_OPTIONS = (Object.entries(SEVERITIES) as [Severity, string][]).map(([k, v]) => ({
  value: k,
  label: v,
  leading: <span className={clsx('size-2 rounded-full', k === 'low' ? 'bg-ink-4' : toneDot[SEVERITY_TONE[k]], k === 'critical' && 'ring-2 ring-bad/30')} />,
}));

/** Mangel bearbeiten: Schwere, Beschreibung (Diktat), Foto, Maßnahme, Vorschläge. */
export function DefectEditor<T extends DefectLike>({
  defect,
  onChange,
  onRemove,
  editableTitle,
  className,
}: {
  defect: T;
  onChange: (d: T) => void;
  onRemove?: () => void;
  editableTitle?: boolean;
  className?: string;
}) {
  const photos = useContext(PhotoCtx);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <div className={clsx('flex flex-col gap-3', className)}>
      {editableTitle && (
        <div className="flex gap-2">
          <DictateInput placeholder="Was wurde festgestellt?" aria-label="Bezeichnung" value={defect.title} onChange={(e) => onChange({ ...defect, title: e.target.value })} />
          {onRemove && (
            <Button variant="ghost" aria-label="Entfernen" onClick={onRemove} className="px-3">
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      )}
      <RadioChips label="Schweregrad" value={defect.severity} onChange={(severity) => onChange({ ...defect, severity })} options={SEVERITY_OPTIONS} fill />
      <div className="flex gap-2">
        <DictateInput placeholder="Beschreibung (optional)" aria-label="Beschreibung" value={defect.note} onChange={(e) => onChange({ ...defect, note: e.target.value })} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            setUploading(true);
            setErr('');
            try {
              onChange({ ...defect, photoKey: await photos.upload(f) });
            } catch (x) {
              setErr(x instanceof Error ? x.message : 'Hochladen fehlgeschlagen');
            } finally {
              setUploading(false);
              e.target.value = '';
            }
          }}
        />
        <Button variant="secondary" aria-label="Foto aufnehmen" loading={uploading} onClick={() => fileRef.current?.click()} className="w-11 px-0 sm:h-10 sm:w-10">
          {!uploading && <Camera className="size-4" />}
        </Button>
      </div>
      <DictateInput placeholder="Maßnahme, z. B. Schließer tauschen" aria-label="Maßnahme" value={defect.measure ?? ''} onChange={(e) => onChange({ ...defect, measure: e.target.value })} />
      <SmartHints defect={defect} onChange={onChange} />
      {err && <p className="text-caption text-bad">{err}</p>}
      {defect.photoKey && (
        <div className="relative w-fit">
          <img src={photos.src(defect.photoKey)} alt="Foto zum Mangel" className="h-24 rounded-lg object-cover shadow-card" />
          <button
            type="button"
            onClick={() => onChange({ ...defect, photoKey: undefined })}
            className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full bg-ink text-white"
            aria-label="Foto entfernen"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Rahmen um den Mangel unter einem Prüfpunkt: eingerückt, mit Bernstein-Strich. */
export function DefectPanel({ children }: { children: ReactNode }) {
  return <div className="animate-pop rounded-lg border-l-2 border-warn bg-canvas py-3 pr-3 pl-3.5">{children}</div>;
}

/** Mit Verzögerung speichern, sobald sich der Wert ändert (erster Render zählt nicht). */
export function useAutosave<T>(value: T, persist: (v: T) => Promise<unknown>, delay = 700): SaveState {
  const [state, setState] = useState<SaveState>('saved');
  const first = useRef(true);
  const persistRef = useRef(persist);
  persistRef.current = persist;
  // Speichervorgänge nacheinander, damit ein langsamer älterer nicht einen neueren überschreibt
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setState('saving');
    const t = setTimeout(() => {
      queue.current = queue.current
        .then(() => persistRef.current(value))
        .then(() => setState('saved'), () => setState('error'));
    }, delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return state;
}

/** Knopf „Entwurf verwerfen“ mit Rückfrage. */
export function DiscardButton({ onDiscard }: { onDiscard: () => Promise<void> | void }) {
  const [confirm, confirmEl] = useConfirm();
  return (
    <>
      {confirmEl}
      <button
        type="button"
        onClick={async () => {
          if (await confirm({ title: 'Entwurf verwerfen?', text: 'Alle Eingaben zu diesem Entwurf gehen verloren.', confirmLabel: 'Verwerfen', danger: true })) await onDiscard();
        }}
        className="inline-flex h-10 items-center gap-1.5 self-center rounded-lg px-3 text-meta text-ink-3 transition-colors hover:bg-bad-soft hover:text-bad"
      >
        <Trash2 className="size-4" /> Entwurf verwerfen
      </button>
    </>
  );
}

// ---------- Komplettes Prüfformular für ein Element ----------
export interface InspectionDraft {
  /** Arten der Prüfung (mindestens eine) */
  kinds: string[];
  notInspectable: boolean;
  answers: Record<string, Answer>;
  maintenance: string[];
  defects: DefectDraft[];
  photos: { key: string; caption: string }[];
  notes: string;
  signature: string | null;
  signerName: string;
  resultOverride?: ResultOverride | null;
  resultReason?: string;
  /** bekannte Mängel, die als behoben gemeldet wurden (IDs) */
  resolvedDefects?: string[];
}

export interface InspectionSubject {
  code: string;
  category: Category;
  location: string;
  buildingName: string;
  propertyName: string;
}

export function InspectionForm({
  subject,
  scheduleLabel,
  checkpoints,
  inspectorName,
  initial,
  back,
  persist,
  submit,
  discard,
  offline,
  banner,
  knownDefects = [],
}: {
  subject: InspectionSubject;
  scheduleLabel?: string;
  /** Hinweis oben, z. B. bei Berichtigung oder Nachprüfung */
  banner?: ReactNode;
  checkpoints: Checkpoint[];
  inspectorName: string;
  initial: InspectionDraft;
  back: string;
  persist: (d: InspectionDraft) => Promise<unknown>;
  submit: (d: InspectionDraft) => Promise<void>;
  discard: () => Promise<void>;
  offline?: boolean;
  /** offene Mängel des Elements aus früheren Prüfungen */
  knownDefects?: KnownDefect[];
}) {
  const def = getCategory(subject.category);
  const [d, setD] = useState<InspectionDraft>(initial);
  const saveState = useAutosave(d, persist);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [confirm, confirmEl] = useConfirm();
  const listRef = useRef<HTMLDivElement>(null);
  const update = useCallback((patch: Partial<InspectionDraft>) => setD((s) => ({ ...s, ...patch })), []);
  const ids = checkpoints.map((c) => c.id);
  const answered = ids.filter((i) => d.answers[i]).length;
  const open = ids.length - answered;
  const complete = isComplete(ids, d.answers, d.notInspectable);
  const computed = computeResult({ notInspectable: d.notInspectable, answers: d.answers, defects: d.defects });
  const result = finalResult(computed, d.resultOverride, d.defects.length);
  const needsReason = !d.notInspectable && !!d.resultOverride && d.resultOverride !== computed && (d.resultReason ?? '').trim().length < 3;
  const firstOpen = checkpoints.find((c) => !d.answers[c.id]);
  const untitled = d.defects.some((x) => !x.title.trim());

  const known = groupKnownDefects(knownDefects, ids);
  const decide = (k: KnownDefect, decision: KnownDecision) => setD((s) => decideKnown(s, k, decision, ids));

  const setAnswer = (cp: Checkpoint, a: Answer) => {
    const here = known.byCheckpoint.get(cp.id) ?? [];
    // Antwort ≠ i. O. nimmt „Behoben“ bei bekannten Mängeln dieses Punktes zurück
    const resolvedDefects = a === 'ok' ? d.resolvedDefects : d.resolvedDefects?.filter((x) => !here.some((k) => k.id === x));
    if (a === 'defect' && here.length && !d.defects.some((x) => x.checkpointId === cp.id)) {
      // Mangel an einem Punkt mit bekanntem Mangel: den bekannten weiterführen statt einen neuen anzulegen
      setD((s) => decideKnown({ ...s, resolvedDefects }, here[0]!, 'present', ids));
      return;
    }
    const answers = { ...d.answers, [cp.id]: a };
    let defects = d.defects;
    if (a === 'defect' && !defects.some((x) => x.checkpointId === cp.id)) defects = [...defects, { checkpointId: cp.id, title: cp.label, note: '', severity: 'medium' }];
    if (a !== 'defect') defects = defects.filter((x) => x.checkpointId !== cp.id);
    update({ answers, defects, resolvedDefects });
    // bei i. O./n. z. weiter zum nächsten offenen Punkt; bei Mangel bleibt der Blick hier
    if (a !== 'defect') revealNextOpen(listRef.current, cp.id);
  };

  const restOk = async () => {
    const ok = await confirm({
      title: `${open} offene ${open === 1 ? 'Punkt' : 'Punkte'} auf „In Ordnung“ setzen?`,
      text: 'Bestätige nur, wenn du diese Punkte vor Ort geprüft hast. Bereits beantwortete Punkte bleiben unverändert.',
      confirmLabel: 'Alle i. O. setzen',
    });
    if (ok) update({ answers: Object.fromEntries(ids.map((i) => [i, d.answers[i] ?? 'ok'])) });
  };

  const onSubmit = () => finish(d);
  const finish = async (draft: InspectionDraft) => {
    setError('');
    setSubmitting(true);
    try {
      await submit(draft);
    } catch (e) {
      // gemerkte Unterschrift bleibt im Entwurf, damit ein erneuter Versuch reicht
      if (draft !== d) setD(draft);
      setError(e instanceof Error ? e.message : 'Abschließen fehlgeschlagen');
    } finally {
      setSubmitting(false);
    }
  };

  const steps: RunStep[] = [
    { key: 'kind', label: 'Art der Prüfung', todo: 'Art der Prüfung wählen', done: !!d.kinds?.length, go: () => jumpTo('ablauf') },
    ...(!d.notInspectable
      ? [
          {
            key: 'points',
            label: 'Alle Prüfpunkte beantwortet',
            todo: `Noch ${open} ${open === 1 ? 'Prüfpunkt' : 'Prüfpunkte'} offen`,
            value: `${answered}/${ids.length}`,
            done: complete,
            go: () => reveal(firstOpen && listRef.current?.querySelector(`[data-cp="${firstOpen.id}"]`)),
          },
          { key: 'titles', label: 'Mängel benannt', todo: 'Mangel ohne Bezeichnung', done: !untitled, go: () => jumpTo('weitere-maengel') },
          { key: 'reason', label: 'Gesamtbewertung', todo: 'Begründung zur Gesamtbewertung fehlt', done: !needsReason, go: () => jumpTo('gesamtbewertung') },
        ]
      : []),
    { key: 'sign', label: 'Unterschrieben', todo: 'Unterschrift fehlt', done: !!d.signature, go: () => jumpTo('unterschrift') },
  ];

  return (
    <RunFrame
      back={back}
      icon={<CategoryIcon category={subject.category} size="sm" />}
      title={
        <>
          {subject.code} <span className="font-normal text-ink-3">· {def.label}</span>
        </>
      }
      subtitle={[scheduleLabel, subject.location, subject.buildingName].filter(Boolean).join(' · ')}
      save={offline && saveState === 'saved' ? 'local' : saveState}
      done={d.notInspectable ? ids.length : answered}
      total={ids.length}
      result={result}
      extraResult={d.defects.length ? defectsLabel(d.defects.length) : undefined}
      steps={steps}
      error={error}
      submitting={submitting}
      onSubmit={onSubmit}
      submitLabel={offline ? 'Abschließen (offline)' : 'Abschließen'}
    >
      {confirmEl}
      {(offline || banner) && (
        <div className="-mb-3 flex flex-col gap-3">
          {offline && (
            <Notice tone="info" title="Offline-Prüfung">
              Wird auf diesem Gerät gespeichert und übertragen, sobald du wieder Netz hast.
            </Notice>
          )}
          {banner}
        </div>
      )}

      <section id="ablauf" className="scroll-mt-24">
        <Card className="flex flex-col gap-4 p-4 sm:p-5">
          <KindPicker value={d.kinds ?? []} onChange={(kinds) => update({ kinds })} />
          <div className="border-t border-line pt-4">
            <Switch
              checked={d.notInspectable}
              onChange={(notInspectable) => update({ notInspectable })}
              label="Nicht prüfbar"
              description="Zum Beispiel kein Zugang – Prüfpunkte entfallen."
            />
          </div>
        </Card>
      </section>

      {!d.notInspectable && !offline && (
        <VoicePanel
          checkpoints={checkpoints}
          onApply={(items: CaptureItem[]) => {
            const answers = { ...d.answers };
            let defects = [...d.defects];
            const notes: string[] = [];
            for (const it of items) {
              if (it.kind === 'asset') continue; // Sammelanlagen gibt es nur unter „Erfassen“
              if (it.kind !== 'defect') {
                notes.push(it.title + (it.note ? ` – ${it.note}` : ''));
                continue;
              }
              const cp = checkpoints.find((c) => c.id === it.checkpointId);
              const nd = { checkpointId: cp?.id, title: it.title, note: it.note, measure: it.measure, severity: it.severity };
              if (cp) {
                answers[cp.id] = 'defect';
                defects = [...defects.filter((x) => x.checkpointId !== cp.id), nd];
              } else defects = [...defects, nd];
            }
            update({ answers, defects, notes: notes.length ? [d.notes.trim(), ...notes].filter(Boolean).join('\n') : d.notes });
          }}
        />
      )}

      {!d.notInspectable && (
        <section>
          <SectionHeader
            title="Prüfpunkte"
            meta={`${answered} von ${ids.length}`}
            action={
              open > 0 ? (
                <Button size="sm" variant="ghost" icon={<CheckCheck />} onClick={restOk}>
                  Rest i. O.
                </Button>
              ) : (
                <span className="text-meta font-medium text-ok">Alle beantwortet</span>
              )
            }
          />
          <Card className="overflow-hidden">
            <div ref={listRef} className="divide-y divide-line">
              {checkpoints.map((cp, idx) => {
                const defect = d.defects.find((x) => x.checkpointId === cp.id && !x.knownId);
                const here = known.byCheckpoint.get(cp.id) ?? [];
                return (
                  <CheckpointRow
                    key={cp.id}
                    id={cp.id}
                    n={idx + 1}
                    label={cp.label}
                    hint={cp.hint}
                    answer={d.answers[cp.id]}
                    current={firstOpen?.id === cp.id && answered > 0}
                    onAnswer={(v) => setAnswer(cp, v)}
                  >
                    {(here.length > 0 || defect) && (
                      <div className="flex flex-col gap-3">
                        {here.map((k) => (
                          <KnownDefectCard key={k.id} k={k} decision={knownDecision(d, k.id)} onDecide={(x) => decide(k, x)} />
                        ))}
                        {defect && (
                          <DefectPanel>
                            <DefectEditor defect={defect} onChange={(nd) => update({ defects: d.defects.map((x) => (x === defect ? nd : x)) })} />
                          </DefectPanel>
                        )}
                      </div>
                    )}
                  </CheckpointRow>
                );
              })}
            </div>
          </Card>
        </section>
      )}

      {!d.notInspectable && known.loose.length > 0 && (
        <section id="bekannte-maengel" className="scroll-mt-24">
          <SectionHeader title="Bekannte Mängel" meta="ohne passenden Prüfpunkt" />
          <Card className="flex flex-col gap-3 p-3 sm:p-4">
            {known.loose.map((k) => (
              <KnownDefectCard key={k.id} k={k} decision={knownDecision(d, k.id)} onDecide={(x) => decide(k, x)} />
            ))}
          </Card>
        </section>
      )}

      {!d.notInspectable && (
        <section id="weitere-maengel" className="scroll-mt-24">
          <SectionHeader title="Weitere Mängel" meta="ohne Prüfpunkt" />
          <div className="flex flex-col gap-3">
            {d.defects
              .filter((x) => !x.checkpointId && !x.knownId)
              .map((x, i) => (
                <Card key={i} className="animate-pop p-4">
                  <DefectEditor
                    defect={x}
                    editableTitle
                    onChange={(nd) => update({ defects: d.defects.map((y) => (y === x ? nd : y)) })}
                    onRemove={() => update({ defects: d.defects.filter((y) => y !== x) })}
                  />
                </Card>
              ))}
            <AddButton onClick={() => update({ defects: [...d.defects, { title: '', note: '', severity: 'medium' }] })}>Mangel ohne Prüfpunkt erfassen</AddButton>
          </div>
        </section>
      )}

      {def.maintenance.length > 0 && (
        <section>
          <SectionHeader title="Durchgeführte Arbeiten" meta={d.maintenance.length ? `${d.maintenance.length} gewählt` : 'optional'} />
          <div className="flex flex-wrap gap-2">
            {def.maintenance.map((m) => {
              const on = d.maintenance.includes(m.key);
              return (
                <ToggleChip key={m.key} active={on} onClick={() => update({ maintenance: on ? d.maintenance.filter((k) => k !== m.key) : [...d.maintenance, m.key] })}>
                  {m.label}
                </ToggleChip>
              );
            })}
          </div>
        </section>
      )}

      <PhotoSection photos={d.photos ?? []} onChange={(photos) => update({ photos })} />

      <section>
        <SectionHeader title="Bemerkungen" meta="optional" />
        <Textarea aria-label="Bemerkungen" value={d.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Hinweise zur Prüfung, Absprachen vor Ort …" />
      </section>

      {!d.notInspectable && (
        <OverallResult
          computed={computed}
          override={d.resultOverride ?? null}
          reason={d.resultReason ?? ''}
          defectCount={d.defects.length}
          onChange={(resultOverride, resultReason) => update({ resultOverride, resultReason })}
        />
      )}

      <ReadyList steps={steps} />

      <SignatureSection
        name={d.signerName}
        fallbackName={inspectorName}
        signature={d.signature}
        onName={(signerName) => update({ signerName })}
        onSignature={(signature) => update({ signature })}
        onQuickFinish={steps.every((x) => x.done || x.key === 'sign') ? (signature) => void finish({ ...d, signature }) : undefined}
      />

      <DiscardButton onDiscard={discard} />
    </RunFrame>
  );
}

/** Offener Mangel aus einer früheren Prüfung: weiterhin vorhanden oder behoben? */
function KnownDefectCard({ k, decision, onDecide }: { k: KnownDefect; decision: KnownDecision; onDecide: (d: KnownDecision) => void }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border-l-2 border-warn bg-canvas py-3 pr-3 pl-3.5" data-known={k.id}>
      <p className="text-body">
        <span className="text-ink-3">Bekannter Mangel vom {fmtDate(k.createdAt)}:</span> <span className="font-medium">{k.title}</span>
        <span className="ml-2 inline-flex items-center gap-1.5 align-middle text-meta text-ink-3">
          <span className={clsx('size-2 rounded-full', k.severity === 'low' ? 'bg-ink-4' : toneDot[SEVERITY_TONE[k.severity]])} />
          {SEVERITIES[k.severity]}
        </span>
      </p>
      {k.note && <p className="-mt-1.5 text-meta text-ink-3">{k.note}</p>}
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Bekannter Mangel: ${k.title}`}>
        <ToggleChip active={decision === 'present'} onClick={() => onDecide(decision === 'present' ? 'open' : 'present')}>
          Weiterhin vorhanden
        </ToggleChip>
        <ToggleChip active={decision === 'resolved'} onClick={() => onDecide(decision === 'resolved' ? 'open' : 'resolved')}>
          Behoben
        </ToggleChip>
      </div>
      {decision !== 'open' && (
        <p className="text-caption text-ink-3">
          {decision === 'present' ? 'Bleibt als offener Mangel bestehen – es wird kein neuer angelegt.' : 'Wird mit dem Abschluss als behoben vermerkt.'}
        </p>
      )}
    </div>
  );
}

/** Gestrichelter Knopf zum Hinzufügen (volle Breite). */
export function AddButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-12 items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong text-body font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink sm:h-11"
    >
      <Plus className="size-4" /> {children}
    </button>
  );
}

/** Mehrfachauswahl der Prüfungsarten (eingebaut und eigene des Workspaces). */
function KindPicker({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const { data: me } = useMe();
  const custom: CustomKind[] = me?.tenant.inspectionKinds ?? [];
  const options: [string, string][] = [...Object.entries(INSPECTION_KINDS), ...custom.map((k) => [k.key, k.label] as [string, string])];
  // auch nicht mehr vorhandene Arten anzeigen, damit sie abgewählt werden können
  for (const k of value) if (!options.some(([o]) => o === k)) options.push([k, k]);
  const [edit, setEdit] = useState(false);
  const chosen = options.filter(([k]) => value.includes(k)).map(([, l]) => l);
  if (!edit && chosen.length)
    return (
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-meta text-ink-3">Art der Prüfung</p>
          <p className="truncate text-body font-medium">{chosen.join(', ')}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
          Ändern
        </Button>
      </div>
    );
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-meta font-medium text-ink-2">Art der Prüfung</p>
        {chosen.length > 0 && (
          <Button size="xs" variant="ghost" onClick={() => setEdit(false)}>
            Fertig
          </Button>
        )}
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Art der Prüfung">
        {options.map(([k, label]) => {
          const on = value.includes(k);
          return (
            <ToggleChip key={k} active={on} onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])}>
              {label}
            </ToggleChip>
          );
        })}
      </div>
    </div>
  );
}

/** Gesamtbewertung: automatisch aus den Befunden oder vom Prüfer festgelegt (mit Begründung). */
function OverallResult({
  computed,
  override,
  reason,
  defectCount,
  onChange,
}: {
  computed: keyof typeof RESULT_META;
  override: ResultOverride | null;
  reason: string;
  defectCount: number;
  onChange: (o: ResultOverride | null, reason: string) => void;
}) {
  const differs = !!override && override !== computed;
  return (
    <section id="gesamtbewertung" className="scroll-mt-24">
      <SectionHeader title="Gesamtbewertung" />
      <p className="-mt-1 mb-3 text-meta text-ink-3">Ergibt sich aus den Befunden. Als Sachkundige/r kannst du sie abweichend festlegen.</p>
      <RadioChips<ResultOverride | null>
        label="Gesamtbewertung"
        value={override}
        onChange={(k) => onChange(k, k ? reason : '')}
        options={[
          { value: null, label: `Automatisch (${RESULT_META[computed].label})` },
          { value: 'ok', label: 'Ohne Mängel', disabled: defectCount > 0, title: defectCount > 0 ? 'Nicht möglich, solange Mängel erfasst sind' : undefined },
          { value: 'defects', label: 'Mit Mängeln' },
          { value: 'critical', label: 'Kritisch' },
        ]}
      />
      {differs && (
        <Textarea
          className="mt-3"
          aria-label="Begründung der Gesamtbewertung"
          placeholder="Begründung (erscheint im Protokoll), z. B. „Mehrere Mängel zusammen beeinträchtigen die Schutzfunktion“"
          value={reason}
          onChange={(e) => onChange(override, e.target.value)}
        />
      )}
    </section>
  );
}

/** Allgemeine Fotos zur Prüfung mit Beschriftung. */
export function PhotoSection({ photos, onChange }: { photos: { key: string; caption: string }[]; onChange: (p: { key: string; caption: string }[]) => void }) {
  const store = useContext(PhotoCtx);
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  return (
    <section>
      <SectionHeader title="Fotos" count={photos.length || undefined} meta={photos.length ? undefined : 'optional'} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {photos.map((p, i) => (
          <div key={p.key} className="overflow-hidden rounded-xl bg-surface shadow-card">
            <div className="relative aspect-[4/3] bg-sunken">
              <img src={store.src(p.key)} alt={p.caption || `Foto ${i + 1}`} className="absolute inset-0 size-full object-cover" />
              <button
                type="button"
                aria-label="Foto entfernen"
                onClick={() => onChange(photos.filter((x) => x !== p))}
                className="absolute top-1.5 right-1.5 grid size-8 place-items-center rounded-full bg-ink/80 text-white"
              >
                <X className="size-4" />
              </button>
            </div>
            <input
              value={p.caption}
              aria-label={`Beschriftung Foto ${i + 1}`}
              onChange={(e) => onChange(photos.map((x) => (x === p ? { ...x, caption: e.target.value } : x)))}
              placeholder="Beschriftung"
              className="h-10 w-full border-t border-line px-2.5 text-meta outline-none placeholder:text-ink-4"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={busy}
          className="flex aspect-[4/3] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-line-strong text-meta font-medium text-ink-2 transition-colors hover:bg-hover hover:text-ink"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
          Foto hinzufügen
        </button>
      </div>
      {err && <p className="mt-2 text-caption text-bad">{err}</p>}
      <input
        ref={ref}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={async (e) => {
          const files = [...(e.target.files ?? [])];
          e.target.value = '';
          if (!files.length) return;
          setBusy(true);
          setErr('');
          try {
            const added = [];
            for (const f of files) added.push({ key: await store.upload(f), caption: '' });
            onChange([...photos, ...added]);
          } catch (x) {
            setErr(x instanceof Error ? x.message : 'Hochladen fehlgeschlagen');
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}

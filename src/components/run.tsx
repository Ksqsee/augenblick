import { getCategory } from '../categories';
import clsx from 'clsx';
import { ArrowLeft, Camera, Check, CheckCheck, Cloud, CloudOff, HardDrive, Loader2, Minus, Trash2, X } from 'lucide-react';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { type Category, type Checkpoint, INSPECTION_KINDS, type InspectionKind, SEVERITIES, type Severity } from '../../shared/catalog';
import { type Answer, computeResult, finalResult, isComplete, type Result, type ResultOverride } from '../../shared/logic';
import { type DefectDraft, fileUrl, uploadPhoto } from '../api';
import { defectsLabel, RESULT_META } from '../format';
import { CategoryIcon } from './CategoryIcon';
import { SignaturePad } from './SignaturePad';
import { Button, Card, Input, Select, Textarea } from './ui';

// ---------- Fotos: online → R2, offline → IndexedDB ----------
export interface PhotoStore {
  upload: (file: File) => Promise<string>;
  src: (key: string) => string;
}
const onlinePhotos: PhotoStore = { upload: uploadPhoto, src: fileUrl };
export const PhotoCtx = createContext<PhotoStore>(onlinePhotos);

// ---------- Bausteine ----------
const ANSWERS: { value: Answer; label: string; icon: typeof Check; on: string }[] = [
  { value: 'ok', label: 'In Ordnung', icon: Check, on: 'bg-ok text-white border-ok' },
  { value: 'defect', label: 'Mangel', icon: X, on: 'bg-bad text-white border-bad' },
  { value: 'na', label: 'Nicht zutreffend', icon: Minus, on: 'bg-ink-2 text-white border-ink-2' },
];

export function AnswerButtons({ value, onChange, label }: { value?: Answer; onChange: (a: Answer) => void; label: string }) {
  return (
    <div className="flex shrink-0 overflow-hidden rounded-lg border border-line" role="radiogroup" aria-label={label}>
      {ANSWERS.map((o) => {
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            aria-label={o.label}
            title={o.label}
            onClick={() => onChange(o.value)}
            className={clsx(
              'flex h-11 flex-1 items-center justify-center border-l border-line transition first:border-l-0 sm:h-10 sm:w-14 sm:flex-none',
              value === o.value ? o.on : 'bg-surface text-ink-3 hover:bg-sunken hover:text-ink',
            )}
          >
            <Icon className="size-[18px]" strokeWidth={2.5} />
          </button>
        );
      })}
    </div>
  );
}

export interface DefectLike {
  title: string;
  note: string;
  measure?: string;
  severity: Severity;
  photoKey?: string;
}

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
    <div className={clsx('flex flex-col gap-2.5', className)}>
      {editableTitle && (
        <div className="flex gap-2">
          <Input placeholder="Was wurde festgestellt?" value={defect.title} onChange={(e) => onChange({ ...defect, title: e.target.value })} />
          {onRemove && (
            <Button variant="ghost" aria-label="Entfernen" onClick={onRemove}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Schweregrad">
        {(Object.entries(SEVERITIES) as [Severity, string][]).map(([k, v]) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={defect.severity === k}
            onClick={() => onChange({ ...defect, severity: k })}
            className={clsx(
              'h-7 rounded-full border px-2.5 text-xs font-medium transition',
              defect.severity === k
                ? k === 'critical' || k === 'high'
                  ? 'border-bad bg-bad text-white'
                  : 'border-warn bg-warn text-white'
                : 'border-line bg-surface text-ink-2',
            )}
          >
            {v}
          </button>
        ))}
      </div>
      <div className="flex gap-2">
        <Input placeholder="Beschreibung (optional)" aria-label="Beschreibung" value={defect.note} onChange={(e) => onChange({ ...defect, note: e.target.value })} />
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
              setErr(x instanceof Error ? x.message : 'Upload fehlgeschlagen');
            } finally {
              setUploading(false);
              e.target.value = '';
            }
          }}
        />
        <Button variant="secondary" aria-label="Foto aufnehmen" loading={uploading} onClick={() => fileRef.current?.click()}>
          {!uploading && <Camera className="size-4" />}
        </Button>
      </div>
      <Input placeholder="Maßnahme (z. B. Schließer tauschen, Fachfirma beauftragen)" aria-label="Maßnahme" value={defect.measure ?? ''} onChange={(e) => onChange({ ...defect, measure: e.target.value })} />
      {err && <p className="text-xs text-bad">{err}</p>}
      {defect.photoKey && (
        <div className="relative w-fit">
          <img src={photos.src(defect.photoKey)} alt="Foto zum Mangel" className="h-24 rounded-lg border border-line object-cover" />
          <button
            type="button"
            onClick={() => onChange({ ...defect, photoKey: undefined })}
            className="absolute -top-2 -right-2 grid size-6 place-items-center rounded-full bg-ink text-white"
            aria-label="Foto entfernen"
          >
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export type SaveState = 'saved' | 'saving' | 'error' | 'local';

export function SaveIndicator({ state }: { state: SaveState }) {
  return (
    <span className="flex items-center gap-1 text-xs text-ink-3" aria-live="polite">
      {state === 'saving' ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : state === 'error' ? (
        <CloudOff className="size-3.5 text-bad" />
      ) : state === 'local' ? (
        <HardDrive className="size-3.5" />
      ) : (
        <Cloud className="size-3.5" />
      )}
      <span className="hidden sm:inline">
        {{ saving: 'Speichert …', error: 'Nicht gespeichert', saved: 'Gespeichert', local: 'Auf dem Gerät' }[state]}
      </span>
    </span>
  );
}

/** Rahmen für Prüf-/Begehungsseiten: Kopf mit Fortschritt, Inhalt, Abschlussleiste. */
export function RunFrame({
  back,
  icon,
  title,
  subtitle,
  save,
  progress,
  result,
  extraResult,
  hint,
  error,
  canSubmit,
  submitting,
  onSubmit,
  submitLabel = 'Abschließen',
  children,
}: {
  back: string;
  icon: ReactNode;
  title: ReactNode;
  subtitle: ReactNode;
  save: SaveState;
  progress: number;
  result: Result;
  extraResult?: string;
  hint?: string;
  error?: string;
  canSubmit: boolean;
  submitting: boolean;
  onSubmit: () => void;
  submitLabel?: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-canvas pb-44">
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link to={back} className="rounded-lg p-1.5 hover:bg-sunken" aria-label="Zurück">
            <ArrowLeft className="size-5" />
          </Link>
          {icon}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{title}</p>
            <p className="truncate text-xs text-ink-3">{subtitle}</p>
          </div>
          <SaveIndicator state={save} />
        </div>
        <div className="h-1 bg-sunken">
          <div className="h-full bg-brand transition-all" style={{ width: `${Math.round(progress * 100)}%` }} />
        </div>
      </header>
      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pt-5">{children}</div>
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ink-3">Ergebnis</p>
            <p className={clsx('truncate text-sm font-semibold', { ok: 'text-ok', defects: 'text-warn', critical: 'text-bad', not_inspectable: 'text-ink-2' }[result])}>
              {RESULT_META[result].label}
              {extraResult && ` · ${extraResult}`}
            </p>
          </div>
          {error && <span className="hidden max-w-60 text-xs text-bad sm:block">{error}</span>}
          <Button size="lg" disabled={!canSubmit} loading={submitting} onClick={onSubmit}>
            {submitLabel}
          </Button>
        </div>
        {hint && <p className="mx-auto max-w-3xl px-4 pb-2 text-xs text-ink-3">{hint}</p>}
        {error && <p className="mx-auto max-w-3xl px-4 pb-2 text-xs text-bad sm:hidden">{error}</p>}
      </div>
    </div>
  );
}

export function SignatureBlock({ name, placeholder, signature, onName, onSignature }: { name: string; placeholder: string; signature: string | null; onName: (v: string) => void; onSignature: (v: string | null) => void }) {
  return (
    <section>
      <h2 className="mb-3 text-[15px] font-semibold">Unterschrift</h2>
      <div className="flex flex-col gap-3">
        <Input value={name} onChange={(e) => onName(e.target.value)} placeholder={placeholder} />
        <SignaturePad value={signature} onChange={onSignature} />
      </div>
    </section>
  );
}

/** Mit Verzögerung speichern, sobald sich der Wert ändert (erster Render zählt nicht). */
export function useAutosave<T>(value: T, persist: (v: T) => Promise<unknown>, delay = 700): SaveState {
  const [state, setState] = useState<SaveState>('saved');
  const first = useRef(true);
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setState('saving');
    const t = setTimeout(() => {
      persistRef
        .current(value)
        .then(() => setState('saved'))
        .catch(() => setState('error'));
    }, delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return state;
}

// ---------- Komplettes Prüfformular für ein Element ----------
export interface InspectionDraft {
  kind: InspectionKind;
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
}: {
  subject: InspectionSubject;
  scheduleLabel?: string;
  checkpoints: Checkpoint[];
  inspectorName: string;
  initial: InspectionDraft;
  back: string;
  persist: (d: InspectionDraft) => Promise<unknown>;
  submit: (d: InspectionDraft) => Promise<void>;
  discard: () => Promise<void>;
  offline?: boolean;
}) {
  const def = getCategory(subject.category);
  const [d, setD] = useState<InspectionDraft>(initial);
  const saveState = useAutosave(d, persist);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const update = useCallback((patch: Partial<InspectionDraft>) => setD((s) => ({ ...s, ...patch })), []);
  const ids = checkpoints.map((c) => c.id);
  const answered = ids.filter((i) => d.answers[i]).length;
  const complete = isComplete(ids, d.answers, d.notInspectable);
  const computed = computeResult({ notInspectable: d.notInspectable, answers: d.answers, defects: d.defects });
  const result = finalResult(computed, d.resultOverride, d.defects.length);
  const needsReason = !d.notInspectable && !!d.resultOverride && d.resultOverride !== computed && (d.resultReason ?? '').trim().length < 3;

  const setAnswer = (cp: Checkpoint, a: Answer) => {
    const answers = { ...d.answers, [cp.id]: a };
    let defects = d.defects;
    if (a === 'defect' && !defects.some((x) => x.checkpointId === cp.id)) defects = [...defects, { checkpointId: cp.id, title: cp.label, note: '', severity: 'medium' }];
    if (a !== 'defect') defects = defects.filter((x) => x.checkpointId !== cp.id);
    update({ answers, defects });
  };

  const onSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      await submit(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setSubmitting(false);
    }
  };

  const missing = !complete ? `Noch ${ids.length - answered} Prüfpunkte offen` : needsReason ? 'Begründung zur Gesamtbewertung fehlt' : !d.signature ? 'Unterschrift fehlt' : undefined;

  return (
    <RunFrame
      back={back}
      icon={<CategoryIcon category={subject.category} size="sm" />}
      title={
        <>
          {subject.code} <span className="font-normal text-ink-3">· {def.label}</span>
        </>
      }
      subtitle={[scheduleLabel, subject.location, subject.buildingName, subject.propertyName].filter(Boolean).join(' · ')}
      save={offline && saveState === 'saved' ? 'local' : saveState}
      progress={d.notInspectable ? 1 : answered / ids.length}
      result={result}
      extraResult={d.defects.length ? defectsLabel(d.defects.length) : undefined}
      hint={missing}
      error={error}
      canSubmit={complete && !needsReason && !!d.signature && !d.defects.some((x) => !x.title.trim())}
      submitting={submitting}
      onSubmit={onSubmit}
      submitLabel={offline ? 'Abschließen (offline)' : 'Abschließen'}
    >
      {offline && (
        <div className="rounded-xl border border-info/20 bg-info-soft px-4 py-3 text-sm text-info">
          Offline-Prüfung: wird auf diesem Gerät gespeichert und übertragen, sobald wieder eine Verbindung besteht.
        </div>
      )}
      <Card className="grid grid-cols-1 gap-4 p-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-[13px] font-medium text-ink-2">
          Art der Prüfung
          <Select value={d.kind} onChange={(e) => update({ kind: e.target.value as InspectionKind })}>
            {Object.entries(INSPECTION_KINDS).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex cursor-pointer items-center justify-between gap-3 self-end rounded-lg border border-line px-3 py-2.5 text-sm">
          <span>
            <span className="block font-medium">Nicht prüfbar</span>
            <span className="block text-xs text-ink-3">z. B. kein Zugang</span>
          </span>
          <input type="checkbox" role="switch" className="peer sr-only" checked={d.notInspectable} onChange={(e) => update({ notInspectable: e.target.checked })} />
          <span className="relative h-6 w-10 rounded-full bg-line transition peer-checked:bg-ink after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4" />
        </label>
      </Card>

      {!d.notInspectable && (
        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[15px] font-semibold">
              Prüfpunkte{' '}
              <span className="font-normal text-ink-3 tabular-nums">
                {answered}/{ids.length}
              </span>
            </h2>
            {answered < ids.length && (
              <Button
                size="sm"
                variant="ghost"
                icon={<CheckCheck className="size-4" />}
                onClick={() => update({ answers: Object.fromEntries(ids.map((i) => [i, d.answers[i] ?? 'ok'])) })}
              >
                Rest i. O.
              </Button>
            )}
          </div>
          <Card className="divide-y divide-line overflow-hidden">
            {checkpoints.map((cp, idx) => {
              const a = d.answers[cp.id];
              const defect = d.defects.find((x) => x.checkpointId === cp.id);
              return (
                <div key={cp.id} className={clsx('px-4 py-3.5', a === 'defect' && 'bg-bad-soft/40')}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 gap-3">
                      <span className="mt-0.5 w-5 shrink-0 text-right text-xs text-ink-3 tabular-nums">{idx + 1}</span>
                      <div>
                        <p className="text-sm leading-snug">{cp.label}</p>
                        {cp.hint && <p className="text-xs text-ink-3">{cp.hint}</p>}
                      </div>
                    </div>
                    <div className="ml-8 sm:ml-0">
                      <AnswerButtons value={a} label={cp.label} onChange={(v) => setAnswer(cp, v)} />
                    </div>
                  </div>
                  {defect && (
                    <DefectEditor defect={defect} onChange={(nd) => update({ defects: d.defects.map((x) => (x === defect ? nd : x)) })} className="mt-3 ml-8" />
                  )}
                </div>
              );
            })}
          </Card>
        </section>
      )}

      {!d.notInspectable && (
        <section>
          <h2 className="mb-3 text-[15px] font-semibold">Weitere Mängel</h2>
          <div className="flex flex-col gap-3">
            {d.defects
              .filter((x) => !x.checkpointId)
              .map((x, i) => (
                <Card key={i} className="p-4">
                  <DefectEditor
                    defect={x}
                    editableTitle
                    onChange={(nd) => update({ defects: d.defects.map((y) => (y === x ? nd : y)) })}
                    onRemove={() => update({ defects: d.defects.filter((y) => y !== x) })}
                  />
                </Card>
              ))}
            <button
              type="button"
              onClick={() => update({ defects: [...d.defects, { title: '', note: '', severity: 'medium' }] })}
              className="h-11 rounded-xl border border-dashed border-line-strong text-sm font-medium text-ink-2 hover:bg-sunken"
            >
              + Mangel ohne Prüfpunkt erfassen
            </button>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-[15px] font-semibold">Durchgeführte Arbeiten</h2>
        <div className="flex flex-wrap gap-2">
          {def.maintenance.map((m) => {
            const on = d.maintenance.includes(m.key);
            return (
              <button
                key={m.key}
                type="button"
                aria-pressed={on}
                onClick={() => update({ maintenance: on ? d.maintenance.filter((k) => k !== m.key) : [...d.maintenance, m.key] })}
                className={clsx(
                  'inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-[13px] font-medium transition',
                  on ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
                )}
              >
                {on && <Check className="size-3.5" />}
                {m.label}
              </button>
            );
          })}
        </div>
      </section>

      <PhotoSection photos={d.photos ?? []} onChange={(photos) => update({ photos })} />

      <section>
        <h2 className="mb-3 text-[15px] font-semibold">Bemerkungen</h2>
        <Textarea value={d.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Hinweise zur Prüfung, Absprachen vor Ort …" />
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

      <SignatureBlock
        name={d.signerName}
        placeholder={`Name Prüfer/in (Standard: ${inspectorName})`}
        signature={d.signature}
        onName={(signerName) => update({ signerName })}
        onSignature={(signature) => update({ signature })}
      />

      <button
        type="button"
        onClick={() => confirm('Entwurf verwerfen?') && discard()}
        className="inline-flex items-center gap-1.5 self-start text-[13px] text-ink-3 hover:text-bad"
      >
        <Trash2 className="size-3.5" /> Entwurf verwerfen
      </button>
    </RunFrame>
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
  computed: Result;
  override: ResultOverride | null;
  reason: string;
  defectCount: number;
  onChange: (o: ResultOverride | null, reason: string) => void;
}) {
  const options: [ResultOverride | null, string][] = [
    [null, `Automatisch (${RESULT_META[computed].label})`],
    ['ok', 'Ohne Mängel'],
    ['defects', 'Mit Mängeln'],
    ['critical', 'Kritisch'],
  ];
  const differs = !!override && override !== computed;
  return (
    <section>
      <h2 className="mb-1 text-[15px] font-semibold">Gesamtbewertung</h2>
      <p className="mb-3 text-[13px] text-ink-3">Wird aus den Befunden berechnet. Du kannst sie als Sachkundige/r abweichend festlegen.</p>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Gesamtbewertung">
        {options.map(([k, label]) => {
          const disabled = k === 'ok' && defectCount > 0;
          const on = override === k;
          return (
            <button
              key={label}
              type="button"
              role="radio"
              aria-checked={on}
              disabled={disabled}
              title={disabled ? 'Nicht möglich, solange Mängel erfasst sind' : undefined}
              onClick={() => onChange(k, k ? reason : '')}
              className={clsx(
                'inline-flex h-9 items-center rounded-full border px-3.5 text-[13px] font-medium transition disabled:opacity-40',
                on ? 'border-ink bg-ink text-white' : 'border-line bg-surface text-ink-2 hover:border-line-strong',
              )}
            >
              {label}
            </button>
          );
        })}
      </div>
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
      <h2 className="mb-3 text-[15px] font-semibold">
        Fotos <span className="font-normal text-ink-3">{photos.length ? photos.length : ''}</span>
      </h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {photos.map((p, i) => (
          <div key={p.key} className="overflow-hidden rounded-xl border border-line bg-surface">
            <div className="relative aspect-[4/3] bg-sunken">
              <img src={store.src(p.key)} alt={p.caption || `Foto ${i + 1}`} className="absolute inset-0 size-full object-cover" />
              <button
                type="button"
                aria-label="Foto entfernen"
                onClick={() => onChange(photos.filter((x) => x !== p))}
                className="absolute top-1.5 right-1.5 grid size-7 place-items-center rounded-full bg-ink/80 text-white"
              >
                <X className="size-4" />
              </button>
            </div>
            <input
              value={p.caption}
              onChange={(e) => onChange(photos.map((x) => (x === p ? { ...x, caption: e.target.value } : x)))}
              placeholder="Beschriftung"
              className="w-full border-t border-line px-2.5 py-2 text-xs outline-none"
            />
          </div>
        ))}
        <button
          type="button"
          onClick={() => ref.current?.click()}
          disabled={busy}
          className="flex aspect-[4/3] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong text-sm text-ink-2 hover:bg-sunken"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : <Camera className="size-5" />}
          Foto hinzufügen
        </button>
      </div>
      {err && <p className="mt-2 text-xs text-bad">{err}</p>}
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
            setErr(x instanceof Error ? x.message : 'Upload fehlgeschlagen');
          } finally {
            setBusy(false);
          }
        }}
      />
    </section>
  );
}

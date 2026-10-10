import clsx from 'clsx';
import { ArrowLeft, Camera, Check, CheckCheck, Cloud, CloudOff, Loader2, Minus, Trash2, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CATEGORIES, INSPECTION_KINDS, type InspectionKind, SEVERITIES, type Severity } from '../../shared/catalog';
import { type Answer, computeResult, isComplete } from '../../shared/logic';
import { api, type DefectDraft, fileUrl, type Inspection, queryClient, uploadPhoto, useInspection } from '../api';
import { CategoryIcon } from '../components/CategoryIcon';
import { SignaturePad } from '../components/SignaturePad';
import { Button, Card, ErrorBox, Input, Select, Spinner, Textarea, useToast } from '../components/ui';
import { defectsLabel, RESULT_META } from '../format';

type Draft = Pick<Inspection, 'kind' | 'notInspectable' | 'answers' | 'maintenance' | 'defects' | 'notes' | 'signature' | 'signerName'>;

const ANSWERS: { value: Answer; label: string; icon: typeof Check; on: string }[] = [
  { value: 'ok', label: 'In Ordnung', icon: Check, on: 'bg-ok text-white border-ok' },
  { value: 'defect', label: 'Mangel', icon: X, on: 'bg-bad text-white border-bad' },
  { value: 'na', label: 'Nicht zutreffend', icon: Minus, on: 'bg-ink-2 text-white border-ink-2' },
];

export function InspectionRun() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useInspection(id);
  if (isLoading) return <Spinner className="min-h-dvh items-center" />;
  if (error || !data) return <div className="p-6"><ErrorBox error={error} /></div>;
  if (data.status === 'submitted') {
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="mb-4 text-sm text-ink-3">Diese Prüfung ist bereits abgeschlossen.</p>
        <Link to={`/druck/protokoll/${id}`}>
          <Button>Protokoll ansehen</Button>
        </Link>
      </div>
    );
  }
  return <Runner insp={data} />;
}

function Runner({ insp }: { insp: Inspection }) {
  const navigate = useNavigate();
  const toast = useToast();
  const def = CATEGORIES[insp.asset.category];
  const [d, setD] = useState<Draft>({
    kind: insp.kind,
    notInspectable: insp.notInspectable,
    answers: insp.answers,
    maintenance: insp.maintenance,
    defects: insp.defects,
    notes: insp.notes,
    signature: insp.signature,
    signerName: insp.signerName || '',
  });
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown>(null);
  const first = useRef(true);

  // Autosave (Entwurf) mit kurzer Verzögerung
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaveState('saving');
    const t = setTimeout(() => {
      api(`/inspections/${insp.id}`, { method: 'PUT', body: d })
        .then(() => setSaveState('saved'))
        .catch(() => setSaveState('error'));
    }, 700);
    return () => clearTimeout(t);
  }, [d, insp.id]);

  const update = useCallback((patch: Partial<Draft>) => setD((s) => ({ ...s, ...patch })), []);
  const ids = insp.checkpoints.map((c) => c.id);
  const answered = ids.filter((i) => d.answers[i]).length;
  const complete = isComplete(ids, d.answers, d.notInspectable);
  const result = computeResult({ notInspectable: d.notInspectable, answers: d.answers, defects: d.defects });

  const setAnswer = (cpId: string, label: string, a: Answer) => {
    const answers = { ...d.answers, [cpId]: a };
    let defects = d.defects;
    if (a === 'defect' && !defects.some((x) => x.checkpointId === cpId)) {
      defects = [...defects, { checkpointId: cpId, title: label, note: '', severity: 'medium' }];
    }
    if (a !== 'defect') defects = defects.filter((x) => x.checkpointId !== cpId);
    update({ answers, defects });
  };

  const allOk = () => {
    const answers = { ...d.answers };
    for (const i of ids) if (!answers[i]) answers[i] = 'ok';
    update({ answers });
  };

  const submit = async () => {
    setSubmitError(null);
    setSubmitting(true);
    try {
      await api(`/inspections/${insp.id}/submit`, { body: d });
      await queryClient.invalidateQueries();
      toast('Prüfung abgeschlossen');
      navigate(`/druck/protokoll/${insp.id}`, { replace: true });
    } catch (e) {
      setSubmitError(e);
    } finally {
      setSubmitting(false);
    }
  };

  const discard = async () => {
    if (!confirm('Entwurf verwerfen?')) return;
    await api(`/inspections/${insp.id}`, { method: 'DELETE' });
    await queryClient.invalidateQueries();
    navigate(`/elemente/${insp.assetId}`, { replace: true });
  };

  return (
    <div className="min-h-dvh bg-canvas pb-44">
      {/* Kopf mit Fortschritt */}
      <header className="sticky top-0 z-30 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <Link to={`/elemente/${insp.assetId}`} className="rounded-lg p-1.5 hover:bg-sunken" aria-label="Zurück">
            <ArrowLeft className="size-5" />
          </Link>
          <CategoryIcon category={insp.asset.category} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">
              {insp.asset.code} <span className="font-normal text-ink-3">· {def.label}</span>
            </p>
            <p className="truncate text-xs text-ink-3">
              {[insp.asset.location, insp.asset.buildingName, insp.asset.propertyName].filter(Boolean).join(' · ')}
            </p>
          </div>
          <span className="flex items-center gap-1 text-xs text-ink-3" aria-live="polite">
            {saveState === 'saving' ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : saveState === 'error' ? (
              <CloudOff className="size-3.5 text-bad" />
            ) : (
              <Cloud className="size-3.5" />
            )}
            <span className="hidden sm:inline">{saveState === 'saving' ? 'Speichert …' : saveState === 'error' ? 'Nicht gespeichert' : 'Gespeichert'}</span>
          </span>
        </div>
        <div className="h-1 bg-sunken">
          <div className="h-full bg-brand transition-all" style={{ width: `${d.notInspectable ? 100 : (answered / ids.length) * 100}%` }} />
        </div>
      </header>

      <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 pt-5">
        {/* Rahmendaten */}
        <Card className="grid gap-4 p-4 sm:grid-cols-2">
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
          <label className="flex items-center justify-between gap-3 self-end rounded-lg border border-line px-3 py-2.5 text-sm">
            <span>
              <span className="block font-medium">Nicht prüfbar</span>
              <span className="block text-xs text-ink-3">z. B. kein Zugang</span>
            </span>
            <input
              type="checkbox"
              role="switch"
              className="peer sr-only"
              checked={d.notInspectable}
              onChange={(e) => update({ notInspectable: e.target.checked })}
            />
            <span className="relative h-6 w-10 rounded-full bg-line transition peer-checked:bg-ink after:absolute after:top-0.5 after:left-0.5 after:size-5 after:rounded-full after:bg-white after:shadow after:transition peer-checked:after:translate-x-4" />
          </label>
        </Card>

        {!d.notInspectable && (
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-[15px] font-semibold">
                Prüfpunkte <span className="font-normal text-ink-3 tabular-nums">{answered}/{ids.length}</span>
              </h2>
              {answered < ids.length && (
                <Button size="sm" variant="ghost" icon={<CheckCheck className="size-4" />} onClick={allOk}>
                  Rest i. O.
                </Button>
              )}
            </div>
            <Card className="divide-y divide-line overflow-hidden">
              {insp.checkpoints.map((cp, idx) => {
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
                      <div className="ml-8 flex shrink-0 overflow-hidden rounded-lg border border-line sm:ml-0" role="radiogroup" aria-label={cp.label}>
                        {ANSWERS.map((o) => {
                          const Icon = o.icon;
                          return (
                            <button
                              key={o.value}
                              type="button"
                              role="radio"
                              aria-checked={a === o.value}
                              aria-label={o.label}
                              title={o.label}
                              onClick={() => setAnswer(cp.id, cp.label, o.value)}
                              className={clsx(
                                'flex h-11 flex-1 items-center justify-center border-l border-line transition first:border-l-0 sm:h-10 sm:w-14 sm:flex-none',
                                a === o.value ? o.on : 'bg-surface text-ink-3 hover:bg-sunken hover:text-ink',
                              )}
                            >
                              <Icon className="size-[18px]" strokeWidth={2.5} />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {defect && (
                      <DefectEditor
                        defect={defect}
                        onChange={(nd) => update({ defects: d.defects.map((x) => (x === defect ? nd : x)) })}
                        className="mt-3 ml-8"
                      />
                    )}
                  </div>
                );
              })}
            </Card>
          </section>
        )}

        {/* Zusätzliche Mängel */}
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

        {/* Wartung */}
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

        <section>
          <h2 className="mb-3 text-[15px] font-semibold">Bemerkungen</h2>
          <Textarea value={d.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Hinweise zur Prüfung, Absprachen vor Ort …" />
        </section>

        <section>
          <h2 className="mb-3 text-[15px] font-semibold">Unterschrift Prüfer/in</h2>
          <div className="flex flex-col gap-3">
            <Input value={d.signerName} onChange={(e) => update({ signerName: e.target.value })} placeholder={`Name (Standard: ${insp.inspectorName})`} />
            <SignaturePad value={d.signature} onChange={(signature) => update({ signature })} />
          </div>
        </section>

        <button type="button" onClick={discard} className="inline-flex items-center gap-1.5 self-start text-[13px] text-ink-3 hover:text-bad">
          <Trash2 className="size-3.5" /> Entwurf verwerfen
        </button>
      </div>

      {/* Abschluss-Leiste */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-ink-3">Ergebnis</p>
            <p className={clsx('truncate text-sm font-semibold', { ok: 'text-ok', defects: 'text-warn', critical: 'text-bad', not_inspectable: 'text-ink-2' }[result])}>
              {RESULT_META[result].label}
              {d.defects.length > 0 && ` · ${defectsLabel(d.defects.length)}`}
            </p>
          </div>
          {submitError ? <span className="hidden max-w-60 text-xs text-bad sm:block">{(submitError as Error).message}</span> : null}
          <Button size="lg" disabled={!complete || !d.signature || d.defects.some((x) => !x.title.trim())} loading={submitting} onClick={submit}>
            Abschließen
          </Button>
        </div>
        {(!complete || !d.signature) && (
          <p className="mx-auto max-w-3xl px-4 pb-2 text-xs text-ink-3">
            {!complete ? `Noch ${ids.length - answered} Prüfpunkte offen` : 'Unterschrift fehlt'}
          </p>
        )}
        {!!submitError && <p className="mx-auto max-w-3xl px-4 pb-2 text-xs text-bad sm:hidden">{(submitError as Error).message}</p>}
      </div>
    </div>
  );
}

function DefectEditor({
  defect,
  onChange,
  onRemove,
  editableTitle,
  className,
}: {
  defect: DefectDraft;
  onChange: (d: DefectDraft) => void;
  onRemove?: () => void;
  editableTitle?: boolean;
  className?: string;
}) {
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sevs = useMemo(() => Object.entries(SEVERITIES) as [Severity, string][], []);
  return (
    <div className={clsx('flex flex-col gap-2.5', className)}>
      {editableTitle && (
        <div className="flex gap-2">
          <Input placeholder="Was ist der Mangel?" value={defect.title} onChange={(e) => onChange({ ...defect, title: e.target.value })} />
          {onRemove && (
            <Button variant="ghost" aria-label="Entfernen" onClick={onRemove}>
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-1.5">
        {sevs.map(([k, v]) => (
          <button
            key={k}
            type="button"
            aria-pressed={defect.severity === k}
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
        <Input placeholder="Beschreibung / Maßnahme (optional)" value={defect.note} onChange={(e) => onChange({ ...defect, note: e.target.value })} />
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
            try {
              onChange({ ...defect, photoKey: await uploadPhoto(f) });
            } finally {
              setUploading(false);
              e.target.value = '';
            }
          }}
        />
        <Button variant="secondary" aria-label="Foto" loading={uploading} onClick={() => fileRef.current?.click()}>
          {!uploading && <Camera className="size-4" />}
        </Button>
      </div>
      {defect.photoKey && (
        <div className="relative w-fit">
          <img src={fileUrl(defect.photoKey)} alt="Foto zum Mangel" className="h-24 rounded-lg border border-line object-cover" />
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

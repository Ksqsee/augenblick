import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronDown, ClipboardList, Download, Footprints, Plus, Scale, Trash2 } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SEVERITIES } from '../../shared/catalog';
import { type Answer, computeResult, isComplete } from '../../shared/logic';
import { BUILDING_TYPES, type BuildingType, WALK_SECTIONS, type WalkSection } from '../../shared/walkthrough';
import { api, type Finding, type PropertyDetail, queryClient, useAction, useMe, useProperties, useWalkthrough, useWalkthroughs, type Walkthrough } from '../api';
import { AnswerButtons, DefectEditor, RunFrame, SignatureBlock, useAutosave } from '../components/run';
import { Badge, Button, Card, Empty, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, Textarea, useToast } from '../components/ui';
import { defectsLabel, fmtDate, fmtDateTime, RESULT_META } from '../format';
import { PrintFrame } from './Protocol';

export function WalkthroughsPage() {
  const { data, isLoading, error } = useWalkthroughs();
  const { data: me } = useMe();
  const [starting, setStarting] = useState(false);
  return (
    <>
      <PageHeader
        title="Begehungen"
        subtitle="Brandschutzbegehungen je Objekt mit Fragenkatalog und Rechtsgrundlagen"
        actions={
          me?.user.role !== 'viewer' && (
            <Button icon={<Plus className="size-4" />} onClick={() => setStarting(true)}>
              Begehung starten
            </Button>
          )
        }
      />
      {starting && <StartWalkthrough onClose={() => setStarting(false)} />}
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : !data?.length ? (
        <Card>
          <Empty
            icon={<Footprints className="size-5" />}
            title="Noch keine Begehung"
            text="Bei einer Begehung prüfst du ein ganzes Objekt: Rettungswege, Kennzeichnung, Organisation und mehr. Feststellungen werden zu Mängeln."
          />
        </Card>
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {data.map((w) => (
            <Link
              key={w.id}
              to={w.status === 'draft' ? `/begehung/${w.id}` : `/druck/begehung/${w.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-sunken/60 sm:px-5"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong">
                <Footprints className="size-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">
                  {w.propertyName}
                  {w.buildingName && <span className="font-normal text-ink-3"> · {w.buildingName}</span>}
                </span>
                <span className="block truncate text-xs text-ink-3">
                  {fmtDateTime(w.inspectedAt ?? w.createdAt)} · {w.inspector}
                  {w.buildingType && ` · ${BUILDING_TYPES[w.buildingType]}`}
                </span>
              </span>
              {w.openDefects > 0 && <Badge tone="warn">{defectsLabel(w.openDefects)} offen</Badge>}
              {w.status === 'draft' ? <Badge tone="info">Entwurf</Badge> : w.result && <Badge tone={RESULT_META[w.result].tone}>{RESULT_META[w.result].label}</Badge>}
            </Link>
          ))}
        </Card>
      )}
    </>
  );
}

export function StartWalkthrough({ onClose, propertyId: fixed }: { onClose: () => void; propertyId?: string }) {
  const props = useProperties();
  const navigate = useNavigate();
  const [propertyId, setPropertyId] = useState(fixed ?? '');
  const detail = useQuery({ queryKey: ['property', propertyId], queryFn: () => api<PropertyDetail>(`/properties/${propertyId}`), enabled: !!propertyId });
  const [buildingId, setBuildingId] = useState('');
  const [type, setType] = useState<BuildingType | ''>('');
  const start = useAction(
    () => api<{ id: string }>(`/properties/${propertyId}/walkthroughs`, { body: { buildingId: buildingId || null, buildingType: type || undefined } }),
    (r) => navigate(`/begehung/${r.id}`),
  );
  const effectiveType = type || detail.data?.buildingType || 'general';
  return (
    <Modal
      title="Begehung starten"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={!propertyId} loading={start.isPending} onClick={() => start.mutate(undefined)}>
            Starten
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {start.error && <ErrorBox error={start.error} />}
        {!fixed && (
          <Field label="Objekt">
            {(id) => (
              <Select id={id} value={propertyId} onChange={(e) => setPropertyId(e.target.value)}>
                <option value="">Bitte wählen …</option>
                {props.data?.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
        <Field label="Bereich" hint="Optional – sonst gilt die Begehung für das ganze Objekt">
          {(id) => (
            <Select id={id} value={buildingId} disabled={!detail.data} onChange={(e) => setBuildingId(e.target.value)}>
              <option value="">Gesamtes Objekt</option>
              {detail.data?.buildings.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Nutzung" hint="Bestimmt die zusätzlichen nutzungsspezifischen Fragen">
          {(id) => (
            <Select id={id} value={type || effectiveType} onChange={(e) => setType(e.target.value as BuildingType)}>
              {Object.entries(BUILDING_TYPES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
    </Modal>
  );
}

type WalkDraft = Pick<Walkthrough, 'answers' | 'findings' | 'notes' | 'participants' | 'signature' | 'signerName'>;

export function WalkthroughRun() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useWalkthrough(id);
  if (isLoading) return <Spinner className="min-h-dvh items-center" />;
  if (error || !data)
    return (
      <div className="p-6">
        <ErrorBox error={error} />
      </div>
    );
  if (data.status === 'submitted')
    return (
      <div className="mx-auto max-w-md p-6 text-center">
        <p className="mb-4 text-sm text-ink-3">Diese Begehung ist abgeschlossen.</p>
        <Link to={`/druck/begehung/${id}`}>
          <Button>Protokoll ansehen</Button>
        </Link>
      </div>
    );
  return <WalkRunner w={data} />;
}

function WalkRunner({ w }: { w: Walkthrough }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [d, setD] = useState<WalkDraft>({
    answers: w.answers,
    findings: w.findings,
    notes: w.notes,
    participants: w.participants,
    signature: w.signature,
    signerName: w.signerName,
  });
  const update = useCallback((p: Partial<WalkDraft>) => setD((s) => ({ ...s, ...p })), []);
  const save = useAutosave(d, (v) => api(`/walkthroughs/${w.id}`, { method: 'PUT', body: v }));
  const [open, setOpen] = useState<string | null>(w.questions[0]?.section ?? null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const ids = w.questions.map((q) => q.id);
  const answered = ids.filter((i) => d.answers[i]).length;
  const complete = isComplete(ids, d.answers);
  const result = computeResult({ answers: d.answers, defects: d.findings });
  const sections = useMemo(() => {
    const m = new Map<WalkSection, typeof w.questions>();
    for (const q of w.questions) m.set(q.section as WalkSection, [...(m.get(q.section as WalkSection) ?? []), q]);
    return [...m.entries()];
  }, [w.questions]);

  const setAnswer = (qid: string, text: string, sev: Finding['severity'], a: Answer) => {
    const answers = { ...d.answers, [qid]: a };
    let findings = d.findings;
    if (a === 'defect' && !findings.some((f) => f.questionId === qid)) findings = [...findings, { questionId: qid, title: text, note: '', severity: sev }];
    if (a !== 'defect') findings = findings.filter((f) => f.questionId !== qid);
    update({ answers, findings });
  };

  const submit = async () => {
    setError('');
    setSubmitting(true);
    try {
      await api(`/walkthroughs/${w.id}/submit`, { body: d });
      await queryClient.invalidateQueries();
      toast('Begehung abgeschlossen');
      navigate(`/druck/begehung/${w.id}`, { replace: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Fehler');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <RunFrame
      back={`/objekte/${w.propertyId}`}
      icon={
        <span className="grid size-8 place-items-center rounded-lg bg-brand-soft text-brand-strong">
          <Footprints className="size-4" />
        </span>
      }
      title={
        <>
          Begehung <span className="font-normal text-ink-3">· {BUILDING_TYPES[w.buildingType]}</span>
        </>
      }
      subtitle={[w.buildingName, w.propertyName].filter(Boolean).join(' · ')}
      save={save}
      progress={answered / ids.length}
      result={result}
      extraResult={d.findings.length ? `${d.findings.length} Feststellungen` : undefined}
      hint={!complete ? `Noch ${ids.length - answered} Fragen offen` : !d.signature ? 'Unterschrift fehlt' : undefined}
      error={error}
      canSubmit={complete && !!d.signature && !d.findings.some((f) => !f.title.trim())}
      submitting={submitting}
      onSubmit={submit}
    >
      <Card className="p-4">
        <Field label="Teilnehmende" hint="z. B. Betreiber, Hausmeister, Brandschutzbeauftragte">
          {(id) => <Input id={id} value={d.participants} onChange={(e) => update({ participants: e.target.value })} />}
        </Field>
      </Card>

      {sections.map(([sec, qs]) => {
        const done = qs.filter((q) => d.answers[q.id]).length;
        const defects = qs.filter((q) => d.answers[q.id] === 'defect').length;
        const isOpen = open === sec;
        return (
          <Card key={sec} className="overflow-hidden">
            <button className="flex w-full items-center gap-3 px-4 py-3.5 text-left" onClick={() => setOpen(isOpen ? null : sec)} aria-expanded={isOpen}>
              <span
                className={clsx(
                  'grid size-7 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular-nums',
                  done === qs.length ? (defects ? 'bg-bad text-white' : 'bg-ok text-white') : 'bg-sunken text-ink-2',
                )}
              >
                {done}/{qs.length}
              </span>
              <span className="flex-1 text-sm font-semibold">{WALK_SECTIONS[sec]}</span>
              {defects > 0 && <Badge tone="bad">{defects}</Badge>}
              <ChevronDown className={clsx('size-4 text-ink-3 transition', isOpen && 'rotate-180')} />
            </button>
            {isOpen && (
              <div className="divide-y divide-line border-t border-line">
                {qs.map((q) => {
                  const a = d.answers[q.id];
                  const f = d.findings.find((x) => x.questionId === q.id);
                  return (
                    <div key={q.id} className={clsx('px-4 py-3.5', a === 'defect' && 'bg-bad-soft/40')}>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm leading-snug">{q.text}</p>
                          <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-3">
                            <Scale className="size-3" /> {q.basis} · {SEVERITIES[q.severity]}
                          </p>
                        </div>
                        <AnswerButtons value={a} label={q.text} onChange={(v) => setAnswer(q.id, q.text, q.severity, v)} />
                      </div>
                      {f && <DefectEditor defect={f} className="mt-3" onChange={(nf) => update({ findings: d.findings.map((x) => (x === f ? nf : x)) })} />}
                    </div>
                  );
                })}
                {done < qs.length && (
                  <div className="px-4 py-2.5">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => update({ answers: { ...d.answers, ...Object.fromEntries(qs.filter((q) => !d.answers[q.id]).map((q) => [q.id, 'ok' as Answer])) } })}
                    >
                      Rest des Abschnitts i. O.
                    </Button>
                  </div>
                )}
              </div>
            )}
          </Card>
        );
      })}

      <section>
        <h2 className="mb-3 text-[15px] font-semibold">Weitere Feststellungen</h2>
        <div className="flex flex-col gap-3">
          {d.findings
            .filter((f) => !f.questionId)
            .map((f, i) => (
              <Card key={i} className="p-4">
                <DefectEditor
                  defect={f}
                  editableTitle
                  onChange={(nf) => update({ findings: d.findings.map((x) => (x === f ? nf : x)) })}
                  onRemove={() => update({ findings: d.findings.filter((x) => x !== f) })}
                />
              </Card>
            ))}
          <button
            type="button"
            onClick={() => update({ findings: [...d.findings, { title: '', note: '', severity: 'medium' }] })}
            className="h-11 rounded-xl border border-dashed border-line-strong text-sm font-medium text-ink-2 hover:bg-sunken"
          >
            + Feststellung ohne Katalogfrage
          </button>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-[15px] font-semibold">Bemerkungen</h2>
        <Textarea value={d.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Gesamteindruck, Vereinbarungen, Fristen …" />
      </section>

      <SignatureBlock
        name={d.signerName}
        placeholder={`Name (Standard: ${w.inspectorName})`}
        signature={d.signature}
        onName={(signerName) => update({ signerName })}
        onSignature={(signature) => update({ signature })}
      />

      <button
        type="button"
        onClick={async () => {
          if (!confirm('Entwurf verwerfen?')) return;
          await api(`/walkthroughs/${w.id}`, { method: 'DELETE' });
          await queryClient.invalidateQueries();
          navigate(`/objekte/${w.propertyId}`, { replace: true });
        }}
        className="inline-flex items-center gap-1.5 self-start text-[13px] text-ink-3 hover:text-bad"
      >
        <Trash2 className="size-3.5" /> Entwurf verwerfen
      </button>
    </RunFrame>
  );
}

const ANSWER_LABEL = { ok: 'i. O.', defect: 'Mangel', na: 'n. z.' } as const;

export function WalkthroughProtocol() {
  const { id = '' } = useParams();
  const { data: w, isLoading, error } = useWalkthrough(id);
  if (isLoading) return <Spinner className="min-h-dvh items-center" />;
  if (error || !w)
    return (
      <div className="p-6">
        <ErrorBox error={error} />
      </div>
    );
  const sections = [...new Set(w.questions.map((q) => q.section as WalkSection))];
  const res = w.result ? RESULT_META[w.result] : null;
  return (
    <PrintFrame title="Begehungsprotokoll" back={`/objekte/${w.propertyId}`} actions={<WalkPdfButton w={w} />}>
      <header className="flex items-start justify-between border-b-2 border-ink pb-3">
        <div>
          <p className="text-[11px] tracking-wider text-ink-3 uppercase">{w.tenantName}</p>
          <h1 className="text-xl font-semibold">Protokoll Brandschutzbegehung</h1>
          <p className="text-ink-2">
            {w.propertyName}
            {w.buildingName && ` · ${w.buildingName}`}
          </p>
        </div>
        <div className="text-right text-ink-2">
          <p>{fmtDateTime(w.inspectedAt ?? w.createdAt)}</p>
          <p>Nutzung: {BUILDING_TYPES[w.buildingType]}</p>
          <p>Nächste Begehung: {fmtDate(w.nextDueAt)}</p>
          {w.status === 'draft' && <p className="font-semibold text-bad">ENTWURF</p>}
        </div>
      </header>
      <p className="mt-3 text-ink-2">
        Adresse: {w.propertyAddress.split('\n').join(', ') || '–'} · Durchgeführt von {w.inspectorName}
        {w.participants && ` · Teilnehmende: ${w.participants}`}
      </p>

      {w.findings.length > 0 && (
        <section className="mt-5 break-inside-avoid">
          <h2 className="mb-1.5 text-[13px] font-semibold">Feststellungen ({w.findings.length})</h2>
          <ol className="list-decimal space-y-2 pl-5">
            {w.findings.map((f, i) => {
              const q = w.questions.find((x) => x.id === f.questionId);
              return (
                <li key={i}>
                  <span className="font-medium">{f.title}</span> – {SEVERITIES[f.severity]}
                  {q && <span className="text-ink-3"> ({q.basis})</span>}
                  {f.note && <p className="text-ink-2">{f.note}</p>}
                  {f.photoKey && <img src={`/api/files/${f.photoKey}`} alt="" className="mt-1 h-28 rounded border border-line object-cover" />}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {sections.map((sec) => (
        <section key={sec} className="mt-5">
          <h2 className="mb-1 text-[13px] font-semibold">{WALK_SECTIONS[sec]}</h2>
          <table className="w-full border-collapse">
            <tbody>
              {w.questions
                .filter((q) => q.section === sec)
                .map((q) => {
                  const a = w.answers[q.id];
                  return (
                    <tr key={q.id} className="border-b border-line break-inside-avoid">
                      <td className="py-1 pr-3">{q.text}</td>
                      <td className="w-40 py-1 text-ink-3">{q.basis}</td>
                      <td className={clsx('w-16 py-1 text-right font-medium', a === 'defect' && 'text-bad')}>{a ? ANSWER_LABEL[a] : '–'}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </section>
      ))}

      {w.notes && (
        <section className="mt-5">
          <h2 className="mb-1.5 text-[13px] font-semibold">Bemerkungen</h2>
          <p className="whitespace-pre-line">{w.notes}</p>
        </section>
      )}

      <section className="mt-6 grid grid-cols-2 gap-8 break-inside-avoid">
        <div className={clsx('rounded border-2 p-3', res?.tone === 'ok' ? 'border-ok' : res?.tone === 'bad' ? 'border-bad' : 'border-warn')}>
          <p className="text-[11px] text-ink-3 uppercase">Gesamtergebnis</p>
          <p className="text-base font-semibold">{res?.label ?? 'Offen'}</p>
        </div>
        <div>
          {w.signature && <img src={w.signature} alt="Unterschrift" className="h-16" />}
          <p className="border-t border-ink pt-1">
            {w.signerName || w.inspectorName}, {fmtDate(w.inspectedAt ?? w.createdAt)}
          </p>
        </div>
      </section>
      <p className="mt-6 flex items-center gap-1 text-[10px] text-ink-3">
        <ClipboardList className="size-3" /> Rechtsgrundlagen sind Orientierungshinweise; maßgeblich sind die im Einzelfall geltenden Vorschriften und das Brandschutzkonzept.
      </p>
    </PrintFrame>
  );
}

function WalkPdfButton({ w }: { w: Walkthrough }) {
  const { data: me } = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  return (
    <Button
      icon={<Download className="size-4" />}
      loading={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const { walkthroughPdf, loadBrand, download } = await import('../pdf/reports');
          const { buildFileName } = await import('../../shared/filename');
          const name = buildFileName('Begehung_{objekt}_{datum}', { objekt: w.propertyName, datum: new Date(w.inspectedAt ?? w.createdAt).toISOString().slice(0, 10) });
          download(await walkthroughPdf(w, await loadBrand(me)), name);
        } catch (e) {
          toast(e instanceof Error ? e.message : 'PDF fehlgeschlagen', 'bad');
        } finally {
          setBusy(false);
        }
      }}
    >
      PDF
    </Button>
  );
}

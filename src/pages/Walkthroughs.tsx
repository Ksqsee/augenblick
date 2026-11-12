import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, CheckCheck, ChevronDown, ClipboardList, Download, Footprints, Plus, Repeat, Scale } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { SEVERITIES, WALK_PURPOSES, type WalkPurpose } from '../../shared/catalog';
import { type Answer, computeResult, isComplete } from '../../shared/logic';
import { BUILDING_TYPES, type BuildingType, WALK_SECTIONS, type WalkSection } from '../../shared/walkthrough';
import { api, type Finding, type PropertyDetail, queryClient, useAction, useMe, useProperties, useWalkthrough, useWalkthroughs, type WalkRow, type Walkthrough } from '../api';
import { AddButton, DefectEditor, DefectPanel, DiscardButton, jumpTo, ReadyList, RunFrame, type RunStep, SignatureSection, useAutosave } from '../components/run';
import { CheckpointRow, reveal, revealNextOpen } from '../components/inspect/Checkpoint';
import { RunSkeleton } from './InspectionRun';
import { Button, ButtonLink, DictateInput, Empty, ErrorBox, Field, List, ListRow, Modal, PageHeader, ResultBadge, Section, Select, SkeletonList, Spinner, StatusText, Surface, Textarea, useToast } from '../components/ui';
import { defectsLabel, fmtDate, fmtDateTime, RESULT_META } from '../format';
import { PrintFrame } from './Protocol';

export function WalkthroughsPage() {
  const { data, isLoading, error, refetch } = useWalkthroughs();
  const { data: me } = useMe();
  const [starting, setStarting] = useState(false);
  const canStart = me?.user.role !== 'viewer';
  const drafts = data?.filter((w) => w.status === 'draft') ?? [];
  const done = data?.filter((w) => w.status !== 'draft') ?? [];
  const row = (w: WalkRow) => (
    <ListRow
      key={w.id}
      to={w.status === 'draft' ? `/begehung/${w.id}` : `/druck/begehung/${w.id}`}
      title={
        <>
          {w.propertyName}
          {w.buildingName && <span className="text-ink-3"> · {w.buildingName}</span>}
        </>
      }
      subtitle={[
        fmtDate(w.inspectedAt ?? w.createdAt),
        w.inspector,
        w.purpose && w.purpose !== 'regular' && WALK_PURPOSES[w.purpose],
        w.openDefects > 0 && `${defectsLabel(w.openDefects)} offen`,
      ]
        .filter(Boolean)
        .join(' · ')}
      trailing={w.status === 'draft' ? <StatusText tone="info">Entwurf</StatusText> : w.result && <ResultBadge result={w.result} />}
      chevron
    />
  );
  return (
    <>
      <PageHeader
        title="Begehungen"
        subtitle="Ein ganzes Objekt mit Fragenkatalog und Rechtsgrundlagen prüfen"
        actions={
          canStart && (
            <Button icon={<Plus />} onClick={() => setStarting(true)}>
              Begehung starten
            </Button>
          )
        }
      />
      {starting && <StartWalkthrough onClose={() => setStarting(false)} />}
      {isLoading ? (
        <SkeletonList rows={5} />
      ) : error ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : !data?.length ? (
        <Surface>
          <Empty
            title="Noch keine Begehung"
            text="Bei einer Begehung prüfst du ein ganzes Objekt: Rettungswege, Kennzeichnung, Organisation. Feststellungen werden zu Mängeln."
          />
        </Surface>
      ) : (
        <Surface>
          {drafts.length > 0 && (
            <Section title="Weitermachen" count={drafts.length} flush>
              <List plain aria-label="Offene Begehungen">
                {drafts.map(row)}
              </List>
            </Section>
          )}
          {done.length > 0 && (
            <Section title="Abgeschlossen" count={done.length} flush>
              <List plain aria-label="Abgeschlossene Begehungen">
                {done.map(row)}
              </List>
            </Section>
          )}
        </Surface>
      )}
    </>
  );
}

export function StartWalkthrough({ onClose, propertyId: fixed, followUpOf }: { onClose: () => void; propertyId?: string; followUpOf?: string }) {
  const props = useProperties();
  const navigate = useNavigate();
  const [propertyId, setPropertyId] = useState(fixed ?? '');
  const detail = useQuery({ queryKey: ['property', propertyId], queryFn: () => api<PropertyDetail>(`/properties/${propertyId}`), enabled: !!propertyId });
  const [buildingId, setBuildingId] = useState('');
  const [type, setType] = useState<BuildingType | ''>('');
  const [purpose, setPurpose] = useState<WalkPurpose>(followUpOf ? 'follow_up' : 'regular');
  const [origin, setOrigin] = useState(followUpOf ?? '');
  // Ausgangsbegehungen für eine Nachbegehung: abgeschlossen, mit Feststellungen
  const origins = (detail.data?.walkthroughs ?? []).filter((w) => w.status === 'submitted' && w.result && w.result !== 'ok');
  const start = useAction(
    () =>
      api<{ id: string }>(`/properties/${propertyId}/walkthroughs`, {
        body: purpose === 'follow_up' ? { purpose, followUpOf: origin } : { buildingId: buildingId || null, buildingType: type || undefined, purpose },
      }),
    (r) => navigate(`/begehung/${r.id}`),
  );
  const effectiveType = type || detail.data?.buildingType || 'general';
  return (
    <Modal
      title="Begehung starten"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={!propertyId || (purpose === 'follow_up' && !origin)} loading={start.isPending} onClick={() => start.mutate(undefined)}>
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
        <Field label="Anlass">
          {(id) => (
            <Select id={id} value={purpose} onChange={(e) => setPurpose(e.target.value as WalkPurpose)}>
              {Object.entries(WALK_PURPOSES).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {purpose === 'follow_up' ? (
          <Field label="Ausgangsbegehung" hint="Geprüft werden nur die dort beanstandeten Fragen; behobene Feststellungen werden geschlossen.">
            {(id) => (
              <Select id={id} value={origin} disabled={!detail.data} onChange={(e) => setOrigin(e.target.value)}>
                <option value="">{origins.length ? 'Bitte wählen …' : 'Keine Begehung mit Feststellungen'}</option>
                {origins.map((w) => (
                  <option key={w.id} value={w.id}>
                    {fmtDate(w.inspectedAt)}
                    {w.buildingName ? ` · ${w.buildingName}` : ''} · {w.openDefects} offen
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <>
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
          </>
        )}
      </div>
    </Modal>
  );
}

type WalkDraft = Pick<Walkthrough, 'answers' | 'findings' | 'notes' | 'participants' | 'signature' | 'signerName'>;

export function WalkthroughRun() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useWalkthrough(id);
  if (isLoading) return <RunSkeleton />;
  if (error || !data)
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorBox error={error} onRetry={() => location.reload()} />
      </div>
    );
  if (data.status === 'submitted')
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas p-4">
        <Surface bleed={false} className="flex w-full max-w-sm flex-col gap-2 p-6">
          <p className="text-h3 font-semibold text-ink">Begehung abgeschlossen</p>
          <p className="text-body text-ink-2">Das Protokoll steht bereit.</p>
          <ButtonLink to={`/druck/begehung/${id}`} size="lg" className="mt-4 w-full">
            Protokoll ansehen
          </ButtonLink>
        </Surface>
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
  const firstOpen = w.questions.find((q) => !d.answers[q.id]);

  const setAnswer = (qid: string, text: string, sev: Finding['severity'], a: Answer) => {
    const answers = { ...d.answers, [qid]: a };
    let findings = d.findings;
    if (a === 'defect' && !findings.some((f) => f.questionId === qid)) findings = [...findings, { questionId: qid, title: text, note: '', severity: sev }];
    if (a !== 'defect') findings = findings.filter((f) => f.questionId !== qid);
    update({ answers, findings });
    if (a !== 'defect') revealNextOpen(document.getElementById(`abschnitt-${open}`), qid);
  };

  // zur ersten offenen Frage: Abschnitt aufklappen, dann hinrollen
  const goOpen = () => {
    if (!firstOpen) return;
    setOpen(firstOpen.section);
    window.setTimeout(() => reveal(document.querySelector(`[data-cp="${firstOpen.id}"]`)), 60);
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
      setError(e instanceof Error ? e.message : 'Abschließen fehlgeschlagen');
    } finally {
      setSubmitting(false);
    }
  };

  const untitled = d.findings.some((f) => !f.title.trim());
  const left = ids.length - answered;
  const steps: RunStep[] = [
    { key: 'q', label: 'Alle Fragen beantwortet', todo: `Noch ${left} ${left === 1 ? 'Frage' : 'Fragen'} offen`, value: `${answered}/${ids.length}`, done: complete, go: goOpen },
    { key: 't', label: 'Feststellungen benannt', todo: 'Feststellung ohne Bezeichnung', done: !untitled, go: () => jumpTo('weitere-feststellungen') },
    { key: 's', label: 'Unterschrieben', todo: 'Unterschrift fehlt', done: !!d.signature, go: () => jumpTo('unterschrift') },
  ];

  return (
    <RunFrame
      back={`/objekte/${w.propertyId}`}
      icon={<Footprints className="size-4 text-ink-3" strokeWidth={1.75} />}
      title={
        <>
          Begehung <span className="text-ink-3">· {BUILDING_TYPES[w.buildingType]}</span>
        </>
      }
      subtitle={[w.buildingName, w.propertyName].filter(Boolean).join(' · ')}
      save={save}
      done={answered}
      total={ids.length}
      result={result}
      extraResult={d.findings.length ? `${d.findings.length} ${d.findings.length === 1 ? 'Feststellung' : 'Feststellungen'}` : undefined}
      steps={steps}
      error={error}
      submitting={submitting}
      onSubmit={submit}
    >
      <Surface>
      <Section>
        <Field label="Teilnehmende" hint="z. B. Betreiber, Hausmeister, Brandschutzbeauftragte">
          {(id) => <DictateInput id={id} value={d.participants} onChange={(e) => update({ participants: e.target.value })} />}
        </Field>
      </Section>

      <Section title="Fragenkatalog" action={<span className="text-meta text-ink-3 tabular-nums">{`${answered} von ${ids.length}`}</span>} flush>
        <div className="divide-y divide-line border-t border-line">
          {sections.map(([sec, qs]) => {
            const done = qs.filter((q) => d.answers[q.id]).length;
            const defects = qs.filter((q) => d.answers[q.id] === 'defect').length;
            const isOpen = open === sec;
            const finished = done === qs.length;
            return (
              <div key={sec} id={`abschnitt-${sec}`} className="scroll-mt-20">
                <button className="flex min-h-13 w-full items-center gap-3 px-(--row-px) text-left hover:bg-hover sm:min-h-12" onClick={() => setOpen(isOpen ? null : sec)} aria-expanded={isOpen}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-body text-ink">{WALK_SECTIONS[sec]}</span>
                    {defects > 0 && (
                      <StatusText tone="warn" className="mt-0.5">
                        {defects} {defects === 1 ? 'Feststellung' : 'Feststellungen'}
                      </StatusText>
                    )}
                  </span>
                  <span className="flex shrink-0 items-center gap-1.5 text-meta text-ink-3 tabular-nums">
                    {finished && <Check className="size-3.5 text-ink" strokeWidth={2.5} />}
                    {done}/{qs.length}
                  </span>
                  <ChevronDown className={clsx('size-4 shrink-0 text-ink-4 transition-transform', isOpen && 'rotate-180')} />
                </button>
                {isOpen && (
                  <div className="divide-y divide-line border-t border-line">
                    {qs.map((q, i) => {
                      const a = d.answers[q.id];
                      const f = d.findings.find((x) => x.questionId === q.id);
                      return (
                        <CheckpointRow
                          key={q.id}
                          id={q.id}
                          n={i + 1}
                          label={q.text}
                          hint={
                            <span className="inline-flex items-center gap-1">
                              <Scale className="size-3 shrink-0" /> {q.basis} · {SEVERITIES[q.severity]}
                            </span>
                          }
                          answer={a}
                          current={firstOpen?.id === q.id && answered > 0}
                          onAnswer={(v) => setAnswer(q.id, q.text, q.severity, v)}
                        >
                          {f && (
                            <DefectPanel>
                              <DefectEditor defect={f} onChange={(nf) => update({ findings: d.findings.map((x) => (x === f ? nf : x)) })} />
                            </DefectPanel>
                          )}
                        </CheckpointRow>
                      );
                    })}
                    {done < qs.length && (
                      <div className="px-(--row-px) py-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          className="-ml-3"
                          icon={<CheckCheck />}
                          onClick={() => update({ answers: { ...d.answers, ...Object.fromEntries(qs.filter((q) => !d.answers[q.id]).map((q) => [q.id, 'ok' as Answer])) } })}
                        >
                          Rest des Abschnitts i. O.
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Section>

      <Section id="weitere-feststellungen" title="Weitere Feststellungen" action={<span className="text-meta text-ink-3">ohne Katalogfrage</span>} className="scroll-mt-24">
        <div className="flex flex-col gap-4">
          {d.findings
            .filter((f) => !f.questionId)
            .map((f, i) => (
              <DefectPanel key={i}>
                <DefectEditor
                  defect={f}
                  editableTitle
                  onChange={(nf) => update({ findings: d.findings.map((x) => (x === f ? nf : x)) })}
                  onRemove={() => update({ findings: d.findings.filter((x) => x !== f) })}
                />
              </DefectPanel>
            ))}
          <AddButton onClick={() => update({ findings: [...d.findings, { title: '', note: '', severity: 'medium' }] })}>Feststellung ohne Katalogfrage</AddButton>
        </div>
      </Section>

      <Section title="Bemerkungen" action={<span className="text-meta text-ink-3">optional</span>}>
        <Textarea aria-label="Bemerkungen" value={d.notes} onChange={(e) => update({ notes: e.target.value })} placeholder="Gesamteindruck, Vereinbarungen, Fristen …" />
      </Section>

      <ReadyList steps={steps} />

      <SignatureSection
        name={d.signerName}
        fallbackName={w.inspectorName}
        signature={d.signature}
        onName={(signerName) => update({ signerName })}
        onSignature={(signature) => update({ signature })}
      />
      </Surface>

      <DiscardButton
        onDiscard={async () => {
          await api(`/walkthroughs/${w.id}`, { method: 'DELETE' });
          await queryClient.invalidateQueries();
          navigate(`/objekte/${w.propertyId}`, { replace: true });
        }}
      />
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
    <PrintFrame
      title="Begehungsprotokoll"
      back={`/objekte/${w.propertyId}`}
      actions={
        <>
          <FollowUpWalkButton w={w} />
          <WalkPdfButton w={w} />
        </>
      }
    >
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
          <p>Anlass: {WALK_PURPOSES[w.purpose ?? 'regular']}</p>
          <p>Nächste Begehung: {fmtDate(w.nextDueAt)}</p>
          {w.status === 'draft' && <p className="font-semibold text-bad">ENTWURF</p>}
        </div>
      </header>
      <p className="mt-3 text-ink-2">
        Adresse: {w.propertyAddress.split('\n').join(', ') || '–'} · Durchgeführt von {w.inspectorName}
        {w.participants && ` · Teilnehmende: ${w.participants}`}
      </p>
      {w.followUpOf && (
        <p className="mt-2 rounded border border-line p-2">
          Nachbegehung{' '}
          <Link to={`/druck/begehung/${w.followUpOf}`} className="underline">
            zur Begehung vom {fmtDate(w.followUpDate)}
          </Link>
        </p>
      )}

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
                  {f.measure && <p>Maßnahme: {f.measure}</p>}
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

function FollowUpWalkButton({ w }: { w: Walkthrough }) {
  const { data: me } = useMe();
  const [open, setOpen] = useState(false);
  if (!me || me.user.role === 'viewer' || w.status !== 'submitted' || !Object.values(w.answers).includes('defect')) return null;
  return (
    <>
      <Button variant="ghost" icon={<Repeat className="size-4" />} onClick={() => setOpen(true)}>
        Nachbegehung
      </Button>
      {open && <StartWalkthrough propertyId={w.propertyId} followUpOf={w.id} onClose={() => setOpen(false)} />}
    </>
  );
}

function WalkPdfButton({ w }: { w: Walkthrough }) {
  const { data: me } = useMe();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  if (!me) return null;
  return (
    <Button
      className="max-lg:order-first"
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

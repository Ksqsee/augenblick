// „Unterschreiben“: Prüfungen, die Claude (MCP `inspect`) oder die Person selbst „bereit zur Unterschrift“
// gelegt hat, mit einem Tipp abschließen (docs/plan/v4.md 8.4). Die Unterschrift bleibt beim Menschen –
// gemerkt nur auf diesem Gerät (Signature.tsx), gesendet nur als Teil der Prüfungen (POST /inspections/sign).
import { useQueries, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, ChevronDown, PenLine } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { computeResult, finalResult, type Result } from '../../shared/logic';
import { api, type Inspection, type InspectionRow, useInspections, useMe } from '../api';
import { CategoryGlyph } from '../components/inspect/Glyph';
import { rememberedSignature, rememberSignature, SignaturePad } from '../components/inspect/Signature';
import { Button, ButtonLink, Empty, ErrorBox, Modal, PageHeader, ResultBadge, Section, SeverityBadge, SkeletonList, Surface, useToast } from '../components/ui';
import { categoryLabel, defectsLabel } from '../format';

type SignResponse = { signed: { id: string; code: string; result: Result; nextDueAt: number | null }[]; failed: { id: string; error: string }[] };
type Outcome = SignResponse & { codes: Record<string, string> };

const n2 = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** Ergebnis eines Entwurfs wie beim Abschluss (automatisch oder festgelegt). */
function draftResult(d: Inspection): Result {
  return finalResult(computeResult({ notInspectable: d.notInspectable, answers: d.answers, defects: d.defects }), d.resultOverride, d.defects.length);
}

export function SignPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: me } = useMe();
  const userId = me?.user.id;
  const list = useInspections({ status: 'ready' });
  const rows = list.data ?? [];
  const details = useQueries({ queries: rows.map((r) => ({ queryKey: ['inspection', r.id], queryFn: () => api<Inspection>(`/inspections/${r.id}`) })) });
  const detail = (id: string) => details[rows.findIndex((r) => r.id === id)]?.data;
  const [open, setOpen] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(() => rememberedSignature(userId));
  const [pad, setPad] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  // Gemerkte Unterschrift erst kennen, wenn die Person bekannt ist
  const [seenUser, setSeenUser] = useState(userId);
  if (seenUser !== userId) {
    setSeenUser(userId);
    setSaved(rememberedSignature(userId));
  }

  const sign = async (signature: string) => {
    const ids = rows.map((r) => r.id);
    if (!ids.length) return;
    setBusy(true);
    try {
      const r = await api<SignResponse>('/inspections/sign', { body: { ids, signature } });
      setOutcome({ ...r, codes: Object.fromEntries(rows.map((x) => [x.id, x.code])) });
      setPad(false);
      setOpen(null);
      await qc.invalidateQueries();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Unterschreiben fehlgeschlagen', 'bad');
    } finally {
      setBusy(false);
    }
  };

  const n = rows.length;
  const allLabel = n === 1 ? 'Unterschreiben' : `Alle ${n} unterschreiben`;
  const name = me?.user.name ?? '';

  return (
    <>
      <PageHeader
        title="Unterschreiben"
        subtitle={list.isLoading ? ' ' : n ? `${n2(n, 'Prüfung wartet', 'Prüfungen warten')} auf deine Unterschrift.` : 'Fertig vorbereitete Prüfungen schließt du hier mit einer Unterschrift ab.'}
      />
      {list.error ? (
        <ErrorBox error={list.error} onRetry={() => list.refetch()} />
      ) : (
        <Surface>
          {outcome && <OutcomeSection outcome={outcome} />}
          {list.isLoading ? (
            <Section>
              <SkeletonList rows={4} />
            </Section>
          ) : n === 0 ? (
            !outcome && <Empty title="Keine Prüfung wartet auf deine Unterschrift." />
          ) : (
            <>
              <Section title="Bereit zur Unterschrift" count={n} flush>
                <ul className="pk-list" aria-label="Bereit zur Unterschrift" style={{ '--row-inset': '28px' } as React.CSSProperties}>
                  {rows.map((r) => (
                    <ReadyRow
                      key={r.id}
                      row={r}
                      detail={detail(r.id)}
                      open={open === r.id}
                      onToggle={() => setOpen(open === r.id ? null : r.id)}
                      onHold={async (d) => {
                        try {
                          await api(`/inspections/${r.id}`, {
                            method: 'PUT',
                            body: {
                              kinds: d.kinds,
                              notInspectable: d.notInspectable,
                              answers: d.answers,
                              maintenance: d.maintenance,
                              defects: d.defects,
                              photos: d.photos ?? [],
                              notes: d.notes ?? '',
                              signature: null,
                              signerName: d.signerName ?? '',
                              resultOverride: d.resultOverride ?? null,
                              resultReason: d.resultReason ?? '',
                              resolvedDefects: d.resolvedDefects ?? [],
                              ready: false,
                            },
                          });
                          toast(`${r.code} zurückgestellt`);
                          setOpen(null);
                          await qc.invalidateQueries({ queryKey: ['inspections'] });
                        } catch (e) {
                          toast(e instanceof Error ? e.message : 'Fehlgeschlagen', 'bad');
                        }
                      }}
                    />
                  ))}
                </ul>
              </Section>

              {/* Unterschrift: feste Leiste über der Handy-Navigation */}
              <div
                className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 flex items-center gap-3 border-t border-line bg-surface px-(--row-px) py-3 sm:rounded-b-xl lg:bottom-0"
                aria-label="Unterschrift"
                role="group"
              >
                <div className="min-w-0 flex-1">
                  {saved ? (
                    <button type="button" onClick={() => setPad(true)} className="group flex min-h-11 items-center gap-2 text-left" aria-label="Andere Unterschrift">
                      <img src={saved} alt="Gemerkte Unterschrift" className="h-10 w-24 shrink-0 object-contain object-left" />
                      <span className="text-caption text-ink-3 underline decoration-ink-4 underline-offset-4 group-hover:text-ink max-sm:sr-only">Ändern</span>
                    </button>
                  ) : (
                    <p className="text-meta text-ink-3">Unterschrift einmal zeichnen, danach reicht ein Tipp.</p>
                  )}
                </div>
                <Button size="lg" icon={<PenLine />} loading={busy && !pad} onClick={() => (saved ? sign(saved) : setPad(true))}>
                  {allLabel}
                </Button>
              </div>
            </>
          )}
        </Surface>
      )}
      {pad && (
        <SignSheet
          name={name}
          label={allLabel}
          busy={busy}
          canRemember={!!userId}
          onClose={() => setPad(false)}
          onSign={(sig, remember) => {
            if (remember && userId) {
              rememberSignature(userId, sig);
              setSaved(sig);
            }
            void sign(sig);
          }}
        />
      )}
    </>
  );
}

function ReadyRow({ row, detail, open, onToggle, onHold }: { row: InspectionRow; detail?: Inspection; open: boolean; onToggle: () => void; onHold: (d: Inspection) => Promise<void> }) {
  const [holding, setHolding] = useState(false);
  const result = detail ? draftResult(detail) : null;
  const defects = detail?.defects.length ?? 0;
  const meta = [row.location, row.buildingName, defects ? defectsLabel(defects) : null].filter(Boolean).join(' · ');
  return (
    <li data-ready={row.id} className="flex flex-col">
      <button type="button" onClick={onToggle} aria-expanded={open} className="group flex min-h-[52px] w-full items-center gap-3 px-(--row-px) py-2 text-left transition-colors hover:bg-hover sm:min-h-11">
        <span className="flex min-w-4 shrink-0 items-center justify-center text-ink-3 [&>svg]:size-4">
          <CategoryGlyph category={row.category} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body text-ink">
            {row.code} <span className="text-ink-3">· {categoryLabel(row.category)}</span>
          </span>
          <span className="mt-0.5 block truncate text-meta text-ink-3">{meta || '–'}</span>
        </span>
        {result && <ResultBadge result={result} className="shrink-0" />}
        <ChevronDown className={clsx('size-4 shrink-0 text-ink-4 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="animate-pop flex flex-col gap-3 pr-(--row-px) pb-4 pl-[calc(var(--row-px)+28px)]">
          {!detail ? (
            <SkeletonList rows={2} />
          ) : (
            <>
              <p className="text-meta text-ink-3">
                {[detail.scheduleLabel, detail.notInspectable ? 'Nicht prüfbar' : `${Object.keys(detail.answers).length} Prüfpunkte bewertet`].filter(Boolean).join(' · ')}
              </p>
              {detail.defects.length > 0 ? (
                <ul className="flex flex-col gap-2.5 border-l border-ink pl-4" aria-label={`Mängel ${row.code}`}>
                  {detail.defects.map((d, i) => (
                    <li key={i} className="flex flex-col gap-0.5">
                      <span className="text-body text-ink">{d.title}</span>
                      <span className="flex flex-wrap items-center gap-x-2 text-meta text-ink-3">
                        <SeverityBadge severity={d.severity} />
                        {d.knownId && <span>bekannt</span>}
                        {d.measure && <span className="min-w-0">· {d.measure}</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                !detail.notInspectable && <p className="text-body text-ink-2">Alle Prüfpunkte in Ordnung.</p>
              )}
              {!!detail.resolvedDefects?.length && <p className="text-meta text-ink-3">{n2(detail.resolvedDefects.length, 'bekannter Mangel', 'bekannte Mängel')} als behoben gemeldet</p>}
              {detail.notes.trim() && <p className="text-body whitespace-pre-line text-ink-2">{detail.notes}</p>}
              <div className="flex flex-wrap gap-2">
                <ButtonLink to={`/pruefung/${row.id}?von=unterschreiben`} size="sm" variant="secondary">
                  Bearbeiten
                </ButtonLink>
                <Button
                  size="sm"
                  variant="ghost"
                  loading={holding}
                  onClick={async () => {
                    setHolding(true);
                    await onHold(detail);
                    setHolding(false);
                  }}
                >
                  Zurückstellen
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </li>
  );
}

/** Ruhige Bestätigung nach dem Unterschreiben; Abgelehntes je Element mit Grund und Link. */
function OutcomeSection({ outcome }: { outcome: Outcome }) {
  const s = outcome.signed.length;
  const withDefects = outcome.signed.filter((x) => x.result === 'defects' || x.result === 'critical').length;
  const critical = outcome.signed.filter((x) => x.result === 'critical').length;
  return (
    <>
      <Section aria-label="Ergebnis">
        <div className="flex flex-col gap-1" role="status">
          <p className="flex items-center gap-2 text-title text-ink">
            <Check className="size-4 shrink-0" strokeWidth={2.25} />
            {s ? `${n2(s, 'Prüfung', 'Prüfungen')} unterschrieben` : 'Nichts unterschrieben'}
          </p>
          {s > 0 && (
            <p className="text-body text-ink-2">
              {withDefects === s ? (s === 1 ? 'Mit Mängeln' : 'Alle mit Mängeln') : withDefects ? `${withDefects} davon mit Mängeln` : s === 1 ? 'Ohne Mängel' : 'Alle ohne Mängel'}
              {critical > 0 && `, ${critical} kritisch`}.{' '}
              Protokolle und nächste Termine stehen fest.
            </p>
          )}
          {s > 0 && (
            <Link to="/pruefungen?tab=done" className="mt-1 self-start text-meta text-ink-2 underline decoration-ink-4 underline-offset-4 hover:text-ink">
              Durchgeführte Prüfungen ansehen
            </Link>
          )}
        </div>
      </Section>
      {outcome.failed.length > 0 && (
        <Section title="Nicht unterschrieben" count={outcome.failed.length} flush>
          <ul className="pk-list" aria-label="Nicht unterschrieben">
            {outcome.failed.map((f) => (
              <li key={f.id} className="flex min-h-[52px] items-center gap-3 px-(--row-px) py-2">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-body text-ink">{outcome.codes[f.id] ?? 'Prüfung'}</span>
                  <span className="mt-0.5 block text-meta break-words text-shu">{failReason(f.error)}</span>
                </span>
                <Link to={`/pruefung/${f.id}?von=unterschreiben`} className="shrink-0 rounded-md px-2 py-2 text-meta text-ink-2 underline decoration-ink-4 underline-offset-4 hover:text-ink">
                  Öffnen
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  );
}

/** Gründe des Servers verständlich machen (er sagt bei geänderten oder fremden Entwürfen bewusst nur „nicht gefunden“). */
function failReason(error: string) {
  return /nicht gefunden/i.test(error) ? 'Nicht mehr bereit – inzwischen geändert oder unvollständig. Öffnen und prüfen.' : error;
}

/** Unterschrift zeichnen (erstes Mal oder neu) – auf Wunsch auf diesem Gerät merken. */
function SignSheet({ name, label, busy, canRemember, onClose, onSign }: { name: string; label: string; busy: boolean; canRemember: boolean; onClose: () => void; onSign: (sig: string, remember: boolean) => void }) {
  const [sig, setSig] = useState<string | null>(null);
  const [remember, setRemember] = useState(true);
  return (
    <Modal
      title="Unterschrift"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button disabled={!sig} loading={busy} onClick={() => sig && onSign(sig, remember)}>
            {label}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <SignaturePad value={sig} onChange={setSig} caption={name} />
        {canRemember && (
          <label className="flex items-start gap-3 text-body text-ink">
            <input type="checkbox" className="mt-1 size-4 accent-ink" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>
              Auf diesem Gerät merken
              <span className="block text-meta text-ink-3">Nächstes Mal reicht ein Tipp. Gespeichert nur in diesem Browser, nicht auf dem Server.</span>
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
}

/** Für Hinweise anderer Seiten: Anzahl der eigenen bereitliegenden Prüfungen. */
export const readyText = (n: number) => `${n2(n, 'Prüfung wartet', 'Prüfungen warten')} auf deine Unterschrift`;

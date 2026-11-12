// Rundgang: alle fälligen Elemente eines Gebäudes in Laufreihenfolge (Etage, Standort) nacheinander prüfen.
// Nach jeder Prüfung landet man wieder hier – mit Bestätigung und dem nächsten Element im Fokus.
import { useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Category } from '../../shared/catalog';
import { api } from '../api';
import { CategoryGlyph, ProgressLine } from '../components/inspect/Glyph';
import { Button, ButtonLink, Empty, ErrorBox, List, ListRow, PageHeader, PageSkeleton, Section, StatusText, Surface, useToast } from '../components/ui';
import { categoryLabel, fmtDate, fmtRelative } from '../format';
import { useRounds } from './Dashboard';

const doneKey = (b: string) => `pk:round:${b}`;
function readDone(b: string): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(doneKey(b)) ?? '[]');
  } catch {
    return [];
  }
}

/** Nach einer Prüfung im Rundgang: Element als erledigt merken. */
export function markRoundDone(buildingId: string, assetId: string) {
  try {
    sessionStorage.setItem(doneKey(buildingId), JSON.stringify([...new Set([...readDone(buildingId), assetId])]));
  } catch {
    /* egal */
  }
}

function dueLine(nextDueAt: number | null) {
  if (nextDueAt == null) return { text: 'nie geprüft', tone: 'info' as const };
  if (nextDueAt < Date.now()) {
    const r = fmtRelative(nextDueAt);
    return { text: r.startsWith('vor ') ? `überfällig seit ${r.slice(4)}` : 'überfällig', tone: 'bad' as const };
  }
  return { text: `fällig am ${fmtDate(nextDueAt)}`, tone: 'warn' as const };
}

export function RoundPage() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const rounds = useRounds(30);
  const [starting, setStarting] = useState<string | null>(null);
  const startRef = useRef<HTMLButtonElement>(null);
  const justDone = sp.get('fertig');
  const justCode = sp.get('code');

  // nach dem Abschluss: Startknopf des nächsten Elements bekommt den Fokus
  useEffect(() => {
    if (justDone && rounds.data) startRef.current?.focus({ preventScroll: true });
  }, [justDone, rounds.data]);

  if (rounds.isLoading) return <PageSkeleton />;
  if (rounds.error) return <ErrorBox error={rounds.error} onRetry={() => rounds.refetch()} />;
  const r = rounds.data?.find((x) => x.buildingId === id);
  const done = readDone(id);
  const open = r?.assets.filter((a) => !done.includes(a.id)) ?? [];
  const total = open.length + done.length;
  const next = open[0];

  const start = async (assetId: string) => {
    setStarting(assetId);
    try {
      const { id: iid } = await api<{ id: string }>(`/assets/${assetId}/inspections`, { method: 'POST', body: {} });
      qc.invalidateQueries({ queryKey: ['smart'] });
      navigate(`/pruefung/${iid}?rundgang=${id}`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Prüfung konnte nicht gestartet werden', 'bad');
      setStarting(null);
    }
  };

  const nd = next && dueLine(next.nextDueAt);
  const place = (a: { floor?: string | null; location?: string | null }) => [a.floor, a.location].filter(Boolean).join(', ');

  return (
    <div className="mx-auto flex max-w-2xl flex-col">
      <PageHeader
        backTo={{ to: '/', label: 'Heute' }}
        eyebrow={r?.propertyName ?? 'Rundgang'}
        title={r?.buildingName ?? 'Rundgang'}
        subtitle={total > 0 ? `${total} Elemente in Laufreihenfolge` : undefined}
      />

      <Surface>
        {total > 0 && (
          <Section>
            <div className="mb-3 flex items-baseline justify-between text-meta">
              <span className="text-ink tabular-nums">
                {done.length} von {total} geprüft
              </span>
              <span className="text-ink-3 tabular-nums">{Math.round((done.length / total) * 100)} %</span>
            </div>
            <ProgressLine value={(done.length / total) * 100} label="Rundgang" />
            {justDone && (
              <p role="status" className="animate-pop mt-4 flex items-start gap-2 text-body text-ink">
                <Check className="mt-0.5 size-4 shrink-0" strokeWidth={2.25} />
                <span>
                  {justCode ? `${justCode} gespeichert` : 'Prüfung gespeichert'}
                  <span className="text-ink-3"> – das Protokoll liegt unter Prüfungen.</span>
                </span>
              </p>
            )}
          </Section>
        )}

        {next ? (
          <Section title={done.length ? 'Weiter mit' : 'Als Erstes'}>
            <div className="flex flex-col gap-5 pt-1">
              <div>
                <p className="flex items-center gap-2.5 text-h2 font-semibold tracking-tight text-ink">
                  <CategoryGlyph category={next.category} className="size-5" />
                  {next.code}
                </p>
                <p className="mt-1 text-body text-ink-2">
                  {categoryLabel(next.category as Category)}
                  {place(next) && <span className="text-ink-3"> · {place(next)}</span>}
                </p>
                {nd && <StatusText tone={nd.tone} className="mt-2">{nd.text}</StatusText>}
              </div>
              <Button ref={startRef} size="lg" className="w-full sm:w-auto sm:self-start" loading={starting === next.id} onClick={() => start(next.id)}>
                Prüfung starten
              </Button>
            </div>
          </Section>
        ) : (
          <Empty
            title={done.length ? 'Rundgang geschafft' : 'Hier ist nichts fällig'}
            text={done.length ? `${done.length} Elemente geprüft. Die Protokolle findest du unter Prüfungen.` : 'In diesem Gebäude steht in den nächsten 30 Tagen keine Prüfung an.'}
            action={
              <ButtonLink to={done.length ? '/pruefen?tab=done' : '/'} variant="ghost">
                {done.length ? 'Protokolle ansehen' : 'Zurück zu Heute'}
              </ButtonLink>
            }
          />
        )}

        {open.length > 1 && (
          <Section title="Danach" count={open.length - 1} flush>
            <List plain aria-label="Danach">
              {open.slice(1).map((a, i) => {
                const d = dueLine(a.nextDueAt);
                return (
                  <ListRow
                    key={a.id}
                    leading={<span className="w-4 text-right text-meta text-ink-3 tabular-nums">{i + 2}</span>}
                    title={
                      <>
                        {a.code} <span className="text-ink-3">· {place(a) || categoryLabel(a.category as Category)}</span>
                      </>
                    }
                    subtitle={<StatusText tone={d.tone}>{d.text}</StatusText>}
                    trailing={
                      <Button size="sm" variant="ghost" loading={starting === a.id} onClick={() => start(a.id)} aria-label={`${a.code} prüfen`} className="-mr-2">
                        Prüfen
                      </Button>
                    }
                  />
                );
              })}
            </List>
          </Section>
        )}

        {done.length > 0 && next && (
          <Section>
            <p className="text-meta text-ink-3">In diesem Rundgang erledigt: {done.length}</p>
          </Section>
        )}
      </Surface>
    </div>
  );
}

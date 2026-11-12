// Rundgang: alle fälligen Elemente eines Gebäudes in Laufreihenfolge (Etage, Standort) nacheinander prüfen.
// Nach jeder Prüfung landet man wieder hier – mit Bestätigung und dem nächsten Element im Fokus.
import { useQueryClient } from '@tanstack/react-query';
import { Check, CheckCircle2, Footprints, MapPin, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Category } from '../../shared/catalog';
import { api } from '../api';
import { CategoryIcon } from '../components/CategoryIcon';
import { Button, Card, Empty, ErrorBox, List, ListRow, PageHeader, PageSkeleton, SectionHeader, StatusDot, useToast } from '../components/ui';
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

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader
        className="!mb-0"
        backTo={{ to: '/', label: 'Heute' }}
        eyebrow={r?.propertyName ?? 'Rundgang'}
        title={r?.buildingName ?? 'Rundgang'}
        subtitle={total > 0 ? `${total} Elemente in Laufreihenfolge` : undefined}
      />

      {total > 0 && (
        <div>
          <div className="mb-2 flex items-baseline justify-between text-meta">
            <span className="font-medium text-ink tabular-nums">
              {done.length} von {total} geprüft
            </span>
            <span className="text-ink-3 tabular-nums">{Math.round((done.length / total) * 100)} %</span>
          </div>
          <div className="flex h-1.5 gap-0.5 overflow-hidden rounded-full" aria-hidden>
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={i < done.length ? 'flex-1 bg-ok' : 'flex-1 bg-line'} />
            ))}
          </div>
        </div>
      )}

      {justDone && (
        <div role="status" className="animate-pop flex items-center gap-3 rounded-xl bg-ok-soft px-4 py-3 text-ok">
          <CheckCircle2 className="size-5 shrink-0" />
          <p className="min-w-0 flex-1 text-body">
            <span className="font-semibold">{justCode ? `${justCode} gespeichert` : 'Prüfung gespeichert'}</span>
            <span className="text-ink-2"> – das Protokoll liegt unter Prüfungen.</span>
          </p>
        </div>
      )}

      {next ? (
        <Card className="flex flex-col gap-5 p-5 sm:p-6">
          <p className="text-meta font-medium text-ink-3">{done.length ? 'Weiter mit' : 'Als Erstes'}</p>
          <div className="-mt-2 flex items-start gap-3.5">
            <CategoryIcon category={next.category as Category} />
            <div className="min-w-0 flex-1">
              <p className="text-h2 font-semibold tracking-tight">{next.code}</p>
              <p className="text-body text-ink-2">{categoryLabel(next.category as Category)}</p>
            </div>
          </div>
          <div className="flex flex-col gap-1.5 text-meta">
            <span className="flex items-center gap-2 text-ink-2">
              <MapPin className="size-4 shrink-0 text-ink-3" />
              {[next.floor, next.location].filter(Boolean).join(', ') || 'ohne Standort'}
            </span>
            {nd && (
              <span className="flex items-center gap-2 text-ink-2">
                <span className="grid size-4 place-items-center">
                  <StatusDot tone={nd.tone} />
                </span>
                {nd.text}
              </span>
            )}
          </div>
          <Button ref={startRef} size="lg" className="w-full sm:w-auto sm:self-start" loading={starting === next.id} onClick={() => start(next.id)} icon={<Play />}>
            Prüfung starten
          </Button>
        </Card>
      ) : (
        <Card>
          <Empty
            icon={done.length ? <Check /> : <Footprints />}
            title={done.length ? 'Rundgang geschafft' : 'Hier ist nichts fällig'}
            text={done.length ? `${done.length} Elemente geprüft. Die Protokolle findest du unter Prüfungen.` : 'In diesem Gebäude steht in den nächsten 30 Tagen keine Prüfung an.'}
            action={
              <Link to={done.length ? '/pruefungen?tab=done' : '/'}>
                <Button variant="secondary">{done.length ? 'Protokolle ansehen' : 'Zurück zu Heute'}</Button>
              </Link>
            }
          />
        </Card>
      )}

      {open.length > 1 && (
        <section>
          <SectionHeader title="Danach" count={open.length - 1} />
          <List aria-label="Danach">
            {open.slice(1).map((a, i) => {
              const d = dueLine(a.nextDueAt);
              return (
                <ListRow
                  key={a.id}
                  leading={
                    <span className="flex items-center gap-2.5">
                      <span className="w-4 text-right text-caption text-ink-4 tabular-nums">{i + 2}</span>
                      <CategoryIcon category={a.category as Category} size="sm" />
                    </span>
                  }
                  title={
                    <>
                      {a.code} <span className="font-normal text-ink-3">· {[a.floor, a.location].filter(Boolean).join(', ') || categoryLabel(a.category as Category)}</span>
                    </>
                  }
                  subtitle={d.text}
                  tone={d.tone === 'bad' ? 'bad' : undefined}
                  trailing={
                    <Button size="sm" variant="secondary" loading={starting === a.id} onClick={() => start(a.id)} aria-label={`${a.code} prüfen`}>
                      Prüfen
                    </Button>
                  }
                />
              );
            })}
          </List>
        </section>
      )}

      {done.length > 0 && next && (
        <p className="flex items-center gap-1.5 text-meta text-ink-3">
          <Check className="size-4 text-ok" /> In diesem Rundgang erledigt: {done.length}
        </p>
      )}
    </div>
  );
}

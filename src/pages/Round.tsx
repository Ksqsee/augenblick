// Rundgang: alle fälligen Elemente eines Gebäudes in Laufreihenfolge (Etage, Standort) nacheinander prüfen.
import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Check, Footprints, Play } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import type { Category } from '../../shared/catalog';
import { api } from '../api';
import { CategoryIcon } from '../components/CategoryIcon';
import { Button, Card, Empty, ErrorBox, Spinner, useToast } from '../components/ui';
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

export function RoundPage() {
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const rounds = useRounds(30);
  const [starting, setStarting] = useState<string | null>(null);
  if (rounds.isLoading) return <Spinner />;
  if (rounds.error) return <ErrorBox error={rounds.error} />;
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

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link to="/" className="mb-3 inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
          <ArrowLeft className="size-4" /> Heute
        </Link>
        <p className="text-sm text-ink-3">{r?.propertyName ?? 'Rundgang'}</p>
        <h1 className="mt-0.5 text-[26px] leading-tight font-semibold tracking-tight">{r?.buildingName ?? 'Rundgang abgeschlossen'}</h1>
      </div>

      {total > 0 && (
        <div>
          <div className="mb-1.5 flex justify-between text-[13px] text-ink-2">
            <span>
              {done.length} von {total} geprüft
            </span>
            {sp.get('fertig') && <span className="font-medium text-ok">Gespeichert ✓</span>}
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-sunken">
            <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${(done.length / total) * 100}%` }} />
          </div>
        </div>
      )}

      {next ? (
        <Card className="flex flex-col gap-4 p-5">
          <p className="text-xs font-semibold tracking-wider text-ink-3 uppercase">{done.length ? 'Weiter mit' : 'Als Erstes'}</p>
          <div className="flex items-center gap-3">
            <CategoryIcon category={next.category as Category} />
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold">{next.code}</p>
              <p className="truncate text-sm text-ink-2">
                {categoryLabel(next.category as Category)} · {[next.floor, next.location].filter(Boolean).join(', ') || 'ohne Standort'}
              </p>
            </div>
          </div>
          <Button size="lg" loading={starting === next.id} onClick={() => start(next.id)} icon={<Play className="size-5" />}>
            Prüfung starten
          </Button>
        </Card>
      ) : (
        <Card>
          <Empty
            icon={<Footprints className="size-5" />}
            title={done.length ? 'Rundgang geschafft' : 'Hier ist nichts fällig'}
            text={done.length ? `${done.length} Elemente geprüft. Die Protokolle findest du unter Prüfungen.` : 'In diesem Gebäude steht in den nächsten 30 Tagen keine Prüfung an.'}
            action={
              <Link to="/">
                <Button variant="secondary">Zurück zu Heute</Button>
              </Link>
            }
          />
        </Card>
      )}

      {open.length > 1 && (
        <section>
          <h2 className="mb-3 text-[15px] font-semibold">Danach</h2>
          <Card className="divide-y divide-line overflow-hidden">
            {open.slice(1).map((a) => {
              const overdue = a.nextDueAt != null && a.nextDueAt < Date.now();
              return (
                <div key={a.id} className={clsx('flex items-center gap-3 px-4 py-3', overdue && 'bg-bad-soft/40')}>
                  <CategoryIcon category={a.category as Category} size="sm" />
                  <Link to={`/elemente/${a.id}`} className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{a.code}</span>
                    <span className={clsx('block truncate text-xs', overdue ? 'text-bad' : 'text-ink-3')}>
                      {[a.floor, a.location].filter(Boolean).join(', ') || categoryLabel(a.category as Category)} ·{' '}
                      {a.nextDueAt == null ? 'nie geprüft' : overdue ? `überfällig seit ${fmtRelative(a.nextDueAt).replace(/^vor /, '')}` : `fällig ${fmtDate(a.nextDueAt)}`}
                    </span>
                  </Link>
                  <Button size="sm" variant="secondary" loading={starting === a.id} onClick={() => start(a.id)} aria-label={`${a.code} prüfen`}>
                    Prüfen
                  </Button>
                </div>
              );
            })}
          </Card>
        </section>
      )}

      {done.length > 0 && (
        <p className="flex items-center gap-1.5 text-[13px] text-ink-3">
          <Check className="size-4 text-ok" /> In diesem Rundgang erledigt: {done.length}
        </p>
      )}
    </div>
  );
}

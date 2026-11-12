import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { markRoundDone } from './Round';
import { api, type Inspection, queryClient, useInspection } from '../api';
import { InspectionForm } from '../components/run';
import { CheckCircle2 } from 'lucide-react';
import { Button, Card, ErrorBox, Notice, Skeleton, useToast } from '../components/ui';
import { fmtDate } from '../format';

export function InspectionRun() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useInspection(id);
  if (isLoading) return <RunSkeleton />;
  if (error || !data)
    return (
      <div className="mx-auto max-w-md p-6">
        <ErrorBox error={error} onRetry={() => location.reload()} />
      </div>
    );
  if (data.status === 'submitted') {
    return (
      <div className="grid min-h-dvh place-items-center bg-canvas p-6">
        <Card className="flex w-full max-w-sm flex-col items-center gap-3 p-6 text-center">
          <CheckCircle2 className="size-8 text-ok" />
          <p className="text-title font-semibold">Bereits abgeschlossen</p>
          <p className="text-body text-ink-3">Diese Prüfung ist abgeschlossen und kann nur noch berichtigt werden.</p>
          <Link to={`/druck/protokoll/${id}`} className="mt-2 w-full">
            <Button size="lg" className="w-full">
              Protokoll ansehen
            </Button>
          </Link>
        </Card>
      </div>
    );
  }
  return <Online insp={data} />;
}

function Online({ insp }: { insp: Inspection }) {
  const navigate = useNavigate();
  const toast = useToast();
  const round = useSearchParams()[0].get('rundgang');
  return (
    <InspectionForm
      subject={insp.asset}
      scheduleLabel={insp.scheduleLabel}
      checkpoints={insp.checkpoints}
      inspectorName={insp.inspectorName}
      back={round ? `/rundgang/${round}` : `/elemente/${insp.assetId}`}
      banner={
        insp.purpose === 'correction' ? (
          <Notice tone="warn" title={`Berichtigung der Prüfung vom ${insp.supersedesDate ? fmtDate(insp.supersedesDate) : '–'}`}>
            Nach dem Abschluss ersetzt sie die ursprüngliche Prüfung; diese bleibt unverändert als Nachweis unter „Berichtigt“ erhalten.
          </Notice>
        ) : insp.purpose === 'follow_up' ? (
          <Notice tone="info" title={`Nachprüfung zur Prüfung vom ${insp.followUpDate ? fmtDate(insp.followUpDate) : '–'}`}>
            Geprüft werden nur die beanstandeten Punkte. Mängel an Punkten, die jetzt in Ordnung sind, gelten danach als behoben. Der Prüfturnus bleibt unverändert.
          </Notice>
        ) : undefined
      }
      initial={{
        kinds: insp.kinds,
        notInspectable: insp.notInspectable,
        answers: insp.answers,
        maintenance: insp.maintenance,
        defects: insp.defects,
        photos: insp.photos ?? [],
        notes: insp.notes,
        signature: insp.signature,
        signerName: insp.signerName || '',
        resultOverride: insp.resultOverride ?? null,
        resultReason: insp.resultReason ?? '',
      }}
      persist={(d) => api(`/inspections/${insp.id}`, { method: 'PUT', body: d })}
      submit={async (d) => {
        await api(`/inspections/${insp.id}/submit`, { body: d });
        await queryClient.invalidateQueries();
        toast('Prüfung abgeschlossen');
        if (round) {
          markRoundDone(round, insp.assetId);
          navigate(`/rundgang/${round}?fertig=${insp.assetId}&code=${encodeURIComponent(insp.asset.code)}`, { replace: true });
        } else navigate(`/druck/protokoll/${insp.id}`, { replace: true });
      }}
      discard={async () => {
        await api(`/inspections/${insp.id}`, { method: 'DELETE' });
        await queryClient.invalidateQueries();
        navigate(round ? `/rundgang/${round}` : `/elemente/${insp.assetId}`, { replace: true });
      }}
    />
  );
}

/** Platzhalter in der Form des Prüfablaufs. */
export function RunSkeleton() {
  return (
    <div className="min-h-dvh bg-canvas" role="status" aria-label="Lädt">
      <div className="flex h-14 items-center gap-3 border-b border-line bg-surface px-4">
        <Skeleton className="size-8 rounded-lg" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 pt-6">
        <Skeleton className="h-28 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

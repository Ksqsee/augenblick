import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Inspection, queryClient, useInspection } from '../api';
import { InspectionForm } from '../components/run';
import { Button, ErrorBox, Spinner, useToast } from '../components/ui';
import { fmtDate } from '../format';

export function InspectionRun() {
  const { id = '' } = useParams();
  const { data, isLoading, error } = useInspection(id);
  if (isLoading) return <Spinner className="min-h-dvh items-center" />;
  if (error || !data)
    return (
      <div className="p-6">
        <ErrorBox error={error} />
      </div>
    );
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
  return <Online insp={data} />;
}

function Online({ insp }: { insp: Inspection }) {
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <InspectionForm
      subject={insp.asset}
      scheduleLabel={insp.scheduleLabel}
      checkpoints={insp.checkpoints}
      inspectorName={insp.inspectorName}
      back={`/elemente/${insp.assetId}`}
      banner={
        insp.purpose === 'correction' ? (
          <div className="rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-sm text-warn">
            Berichtigung der Prüfung vom {insp.supersedesDate ? fmtDate(insp.supersedesDate) : '–'}. Nach dem Abschluss ersetzt sie die ursprüngliche
            Prüfung; diese bleibt unverändert als Nachweis unter „Berichtigt“ erhalten.
          </div>
        ) : insp.purpose === 'follow_up' ? (
          <div className="rounded-xl border border-info/20 bg-info-soft px-4 py-3 text-sm text-info">
            Nachprüfung zur Prüfung vom {insp.followUpDate ? fmtDate(insp.followUpDate) : '–'}: geprüft werden nur die beanstandeten Punkte. Mängel an
            Punkten, die jetzt in Ordnung sind, gelten danach als behoben. Der Prüfturnus bleibt unverändert.
          </div>
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
        navigate(`/druck/protokoll/${insp.id}`, { replace: true });
      }}
      discard={async () => {
        await api(`/inspections/${insp.id}`, { method: 'DELETE' });
        await queryClient.invalidateQueries();
        navigate(`/elemente/${insp.assetId}`, { replace: true });
      }}
    />
  );
}

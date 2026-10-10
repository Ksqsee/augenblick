import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, type Inspection, queryClient, useInspection } from '../api';
import { InspectionForm } from '../components/run';
import { Button, ErrorBox, Spinner, useToast } from '../components/ui';

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
      checkpoints={insp.checkpoints}
      inspectorName={insp.inspectorName}
      back={`/elemente/${insp.assetId}`}
      initial={{
        kind: insp.kind,
        notInspectable: insp.notInspectable,
        answers: insp.answers,
        maintenance: insp.maintenance,
        defects: insp.defects,
        notes: insp.notes,
        signature: insp.signature,
        signerName: insp.signerName || '',
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

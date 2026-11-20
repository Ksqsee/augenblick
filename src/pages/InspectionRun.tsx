import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { markRoundDone } from './Round';
import { api, type AssetDetail, type Inspection, queryClient, useInspection } from '../api';
import { InspectionForm } from '../components/run';
import { ButtonLink, ErrorBox, Notice, Skeleton, Surface, useToast } from '../components/ui';
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
      <div className="grid min-h-dvh place-items-center bg-canvas p-4">
        <Surface bleed={false} className="flex w-full max-w-sm flex-col gap-2 p-6">
          <p className="text-h3 font-semibold text-ink">Bereits abgeschlossen</p>
          <p className="text-body text-ink-2">Diese Prüfung ist abgeschlossen und kann nur noch berichtigt werden.</p>
          <ButtonLink to={`/druck/protokoll/${id}`} size="lg" className="mt-4 w-full">
            Protokoll ansehen
          </ButtonLink>
        </Surface>
      </div>
    );
  }
  return <Online insp={data} />;
}

function Online({ insp }: { insp: Inspection }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const round = params.get('rundgang');
  // aus „Unterschreiben“ geöffnet: zurück dorthin
  const fromSign = params.get('von') === 'unterschreiben';
  // aus „Tür ansagen“ (Plan v7 W): „Bereit · nächste Tür“ statt Unterschrift, Befund aus der Ansage vorbelegt
  const announced = params.get('ansage') === '1';
  // Plan v8 Z: aus dem Objekt angesagt → zurück in dessen Reiter „Begehung“
  const objekt = params.get('objekt');
  const announceBack = objekt && /^[A-Za-z0-9_-]{1,40}$/.test(objekt) ? `/objekte/${objekt}?tab=begehung` : '/pruefen';
  const finding = (useLocation().state as { finding?: string } | null)?.finding;
  return (
    <InspectionForm
      announce={
        announced
          ? {
              onReady: async (d) => {
                const r = await api<{ ready: boolean; missing: string[] }>(`/inspections/${insp.id}`, { method: 'PUT', body: { ...d, ready: true } });
                if (!r.ready) throw new Error(`Noch nicht bereit: ${r.missing.join('; ') || 'bitte prüfen'}`);
                await queryClient.invalidateQueries();
                toast(`${insp.asset.code} bereit zur Unterschrift`);
                navigate(`${announceBack}${announceBack.includes('?') ? '&' : '?'}ansage=weiter`, { replace: true });
              },
            }
          : undefined
      }
      initialVoice={finding}
      onRawNote={(n) => api(`/inspections/${insp.id}/raw-notes`, { body: { notes: [n] } })}
      onRawEvaluated={() => api(`/inspections/${insp.id}/raw-notes`, { method: 'PATCH', body: { all: true, evaluated: true } })}
      subject={insp.asset}
      scheduleLabel={insp.scheduleLabel}
      checkpoints={insp.checkpoints}
      inspectorName={insp.inspectorName}
      back={round ? `/rundgang/${round}` : fromSign ? '/unterschreiben' : announced ? announceBack : `/elemente/${insp.assetId}`}
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
        resolvedDefects: insp.resolvedDefects ?? [],
        rawNotes: insp.rawNotes ?? [],
      }}
      knownDefects={insp.knownDefects}
      onAttribute={async (attr, value) => {
        // Rückfrage („Hat die Tür eine Feststellanlage?“) dauerhaft am Element speichern
        const a = await api<AssetDetail>(`/assets/${insp.assetId}`);
        await api(`/assets/${insp.assetId}`, {
          method: 'PATCH',
          body: {
            buildingId: a.buildingId,
            location: a.location,
            floor: a.floor,
            manufacturer: a.manufacturer,
            model: a.model,
            labelCode: a.labelCode || undefined,
            number: a.number ?? undefined,
            warnDays: a.warnDays ?? null,
            attributes: { ...a.attributes, [attr]: value },
          },
        });
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
        navigate(round ? `/rundgang/${round}` : fromSign ? '/unterschreiben' : announced ? `${announceBack}${announceBack.includes('?') ? '&' : '?'}ansage=weiter` : `/elemente/${insp.assetId}`, { replace: true });
      }}
    />
  );
}

/** Platzhalter in der Form des Prüfablaufs. */
export function RunSkeleton() {
  return (
    <div className="min-h-dvh bg-canvas" role="status" aria-label="Lädt">
      <div className="flex h-14 items-center gap-3 border-b border-line px-4">
        <Skeleton className="size-6 rounded-md" />
        <div className="flex flex-1 flex-col gap-1.5">
          <Skeleton className="h-3.5 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <div className="mx-auto max-w-3xl px-4 pt-4 sm:pt-6">
        <Surface className="flex flex-col gap-6 px-(--row-px) py-6">
          <Skeleton className="h-10 w-2/3" />
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-3">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-12 rounded-md" />
            </div>
          ))}
        </Surface>
      </div>
    </div>
  );
}

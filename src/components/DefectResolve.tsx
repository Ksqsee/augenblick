import { ArrowRight, Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, fileUrl, uploadPhoto, useAction, useDefect } from '../api';
import { PhotoPicker } from './work/Photos';
import { Button, ErrorBox, Field, Modal, SeverityBadge, Textarea, useToast } from './ui';

/**
 * Behebung dokumentieren: optionale Behebungsnotiz und Nachher-Foto (neben dem Vorher-Foto).
 * Auf dem Handy ein Bottom-Sheet mit vollbreiten Knöpfen.
 * `skipLabel` zeigt eine zweite Schaltfläche (z. B. „Nur Aufgabe erledigen“), die den Mangel offen lässt.
 */
export function ResolveDefectDialog({
  defectId,
  title,
  intro,
  skipLabel,
  onSkip,
  onClose,
  onDone,
}: {
  defectId: string;
  title?: string;
  intro?: string;
  skipLabel?: string;
  onSkip?: () => void;
  onClose: () => void;
  onDone?: () => void;
}) {
  const toast = useToast();
  const { data: d } = useDefect(defectId);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => () => void (photo && URL.revokeObjectURL(photo.url)), [photo]);
  const save = useAction(
    async () => {
      const photoKey = photo ? await uploadPhoto(photo.file) : null;
      return api(`/defects/${defectId}`, { method: 'PATCH', body: { status: 'resolved', note, photoKey } });
    },
    () => {
      toast('Mangel als behoben markiert');
      onDone?.();
      onClose();
    },
  );
  return (
    <Modal
      title={title ?? 'Mangel beheben'}
      description={intro ? undefined : 'Halte kurz fest, was getan wurde. Notiz und Foto sind optional.'}
      onClose={onClose}
      footer={
        <>
          {skipLabel && onSkip ? (
            <Button variant="secondary" onClick={onSkip}>
              {skipLabel}
            </Button>
          ) : (
            <Button variant="secondary" onClick={onClose}>
              Abbrechen
            </Button>
          )}
          <Button icon={<Check className="size-4" />} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Als behoben markieren
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        {intro && <p className="text-body text-ink-2">{intro}</p>}
        {d && (
          <div className="flex items-center gap-3 rounded-xl bg-canvas px-3.5 py-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium">{d.title}</p>
              <p className="truncate text-meta text-ink-3">{[d.code ?? 'Begehung', d.location, d.propertyName].filter(Boolean).join(' · ')}</p>
            </div>
            <SeverityBadge severity={d.severity} />
          </div>
        )}
        {save.error && <ErrorBox error={save.error} />}
        <Field label="Behebungsnotiz" optional hint="Was wurde getan, von wem?">
          {(id) => <Textarea id={id} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Obentürschließer getauscht, Funktion geprüft" />}
        </Field>
        <div>
          <p className="mb-2 flex items-baseline justify-between text-meta font-medium text-ink-2">
            Foto nach der Behebung <span className="text-caption font-normal text-ink-3">optional</span>
          </p>
          <div className="flex items-center gap-3">
            {d?.photoKey && (
              <>
                <figure className="w-24 shrink-0">
                  <img src={fileUrl(d.photoKey)} alt="Vorher-Foto" className="aspect-[4/3] w-full rounded-xl object-cover opacity-90" />
                  <figcaption className="mt-1 text-caption text-ink-3">Vorher</figcaption>
                </figure>
                <ArrowRight className="mb-5 size-4 shrink-0 text-ink-4" />
              </>
            )}
            <div className={d?.photoKey ? 'mb-5' : undefined}>
              <PhotoPicker
                photo={photo}
                label="Nachher-Foto"
                onPick={(f) => setPhoto({ file: f, url: URL.createObjectURL(f) })}
                onClear={() => setPhoto(null)}
              />
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

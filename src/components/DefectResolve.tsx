import { Camera, Check, X } from 'lucide-react';
import { useState } from 'react';
import { api, uploadPhoto, useAction } from '../api';
import { Button, ErrorBox, Field, Modal, Textarea, useToast } from './ui';

/**
 * Behebung dokumentieren: optionale Behebungsnotiz und Nachher-Foto.
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
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);
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
      title={title ?? 'Mangel als behoben markieren'}
      onClose={onClose}
      footer={
        <>
          {skipLabel && onSkip ? (
            <Button variant="ghost" onClick={onSkip}>
              {skipLabel}
            </Button>
          ) : (
            <Button variant="ghost" onClick={onClose}>
              Abbrechen
            </Button>
          )}
          <Button icon={<Check className="size-4" />} loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Als behoben markieren
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {intro && <p className="text-sm text-ink-2">{intro}</p>}
        {save.error && <ErrorBox error={save.error} />}
        <Field label="Behebungsnotiz" hint="Optional – was wurde getan, von wem?">
          {(id) => <Textarea id={id} value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} placeholder="z. B. Obentürschließer getauscht, Funktion geprüft" />}
        </Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium text-ink-2">Nachher-Foto (optional)</p>
          {photo ? (
            <div className="flex items-center gap-3">
              <img src={photo.url} alt="Nachher-Foto" className="h-20 w-28 rounded-lg border border-line object-cover" />
              <Button variant="ghost" size="sm" icon={<X className="size-3.5" />} onClick={() => setPhoto(null)}>
                Entfernen
              </Button>
            </div>
          ) : (
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] font-medium text-ink-2 hover:border-line-strong">
              <Camera className="size-4" /> Foto aufnehmen oder wählen
              <input
                type="file"
                accept="image/*"
                capture="environment"
                className="sr-only"
                aria-label="Nachher-Foto"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) setPhoto({ file: f, url: URL.createObjectURL(f) });
                }}
              />
            </label>
          )}
        </div>
      </div>
    </Modal>
  );
}

// Kunden-Freigabe eines Objekts: Links erstellen, kopieren, widerrufen. Design v3: der Dialog ist die Fläche,
// darin Abschnitte mit Haarlinien – keine Karten, keine getönten Flächen.
import { useQuery } from '@tanstack/react-query';
import { Copy, ExternalLink, Link2, Share2 } from 'lucide-react';
import { useState } from 'react';
import { api, queryClient } from '../api';
import { fmtDate, fmtDateTime } from '../format';
import { Button, Field, Input, Modal, SkeletonList, Switch, useConfirm, useToast } from './ui';

interface ShareRow {
  id: string;
  label: string;
  showDefects: boolean;
  createdAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
  lastViewedAt: number | null;
  views: number;
  createdBy: string;
}

export function SharePropertyButton({ propertyId, propertyName }: { propertyId: string; propertyName: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="ghost" icon={<Share2 className="size-4" />} onClick={() => setOpen(true)} className="max-sm:px-3" title="Für Kunden freigeben">
        <span className="max-sm:sr-only">Für Kunden freigeben</span>
      </Button>
      {open && <ShareDialog propertyId={propertyId} propertyName={propertyName} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ propertyId, propertyName, onClose }: { propertyId: string; propertyName: string; onClose: () => void }) {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const key = ['shares', propertyId];
  const q = useQuery({ queryKey: key, queryFn: () => api<ShareRow[]>(`/properties/${propertyId}/shares`) });
  const [label, setLabel] = useState('');
  const [showDefects, setShowDefects] = useState(true);
  const [busy, setBusy] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ token: string }>(`/properties/${propertyId}/shares`, { body: { label, showDefects, expiresInDays: 365 } });
      setLink(`${location.origin}/kunde/${r.token}`);
      setLabel('');
      queryClient.invalidateQueries({ queryKey: key });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Fehlgeschlagen', 'bad');
    } finally {
      setBusy(false);
    }
  };
  const revoke = async (id: string) => {
    if (!(await confirm({ title: 'Link widerrufen?', text: 'Wer den Link hat, sieht danach nichts mehr.', confirmLabel: 'Widerrufen', danger: true }))) return;
    await api(`/shares/${id}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: key });
    toast('Link widerrufen');
  };
  const active = q.data?.filter((s) => !s.revokedAt && !(s.expiresAt && s.expiresAt < Date.now())) ?? [];
  return (
    <Modal title="Für Kunden freigeben" description={propertyName} onClose={onClose}>
      {confirmEl}
      <div className="flex flex-col gap-6">
        <p className="text-body text-ink-2">
          Auftraggeber sehen über den Link ohne Konto den Prüfstatus: Prüfquote, Fälligkeiten, letzte Prüfungen und auf Wunsch offene Mängel. Keine Fotos, Namen oder internen
          Notizen. Gültig für 1 Jahr.
        </p>
        {link ? (
          <div className="flex flex-col gap-2.5 border-l-2 border-ink pl-3.5">
            <p className="text-body text-ink">Link erstellt – jetzt kopieren, er wird nur einmal angezeigt.</p>
            <div className="flex gap-2">
              <Input readOnly aria-label="Kunden-Link" value={link} onFocus={(e) => e.target.select()} className="font-mono text-caption" />
              <Button
                variant="secondary"
                icon={<Copy className="size-4" />}
                onClick={async () => {
                  await navigator.clipboard.writeText(link).catch(() => {});
                  toast('Link kopiert');
                }}
              >
                Kopieren
              </Button>
            </div>
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 self-start text-meta font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline">
              Ansicht öffnen <ExternalLink className="size-3.5" />
            </a>
          </div>
        ) : (
          <div className="flex flex-col gap-4 border-t border-line pt-5">
            <Field label="Für wen? (optional)" hint="z. B. Hausverwaltung Müller – erscheint nur hier in der Liste">
              {(id) => <Input id={id} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />}
            </Field>
            <Switch checked={showDefects} onChange={setShowDefects} label="Offene Mängel anzeigen" description="Titel und Schweregrad, ohne Fotos" />
            <Button loading={busy} onClick={create} icon={<Link2 className="size-4" />} className="self-start">
              Link erstellen
            </Button>
          </div>
        )}
        <div className="border-t border-line pt-5">
          <p className="mb-1 text-meta font-medium text-ink-3">Aktive Links</p>
          {q.isLoading ? (
            <SkeletonList rows={1} />
          ) : !active.length ? (
            <p className="text-body text-ink-2">Noch keine.</p>
          ) : (
            <ul className="divide-y divide-line">
              {active.map((s) => (
                <li key={s.id} className="flex min-h-14 items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className={`truncate text-body ${s.label ? 'text-ink' : 'text-ink-3'}`}>{s.label || 'Ohne Bezeichnung'}</p>
                    <p className="truncate text-meta text-ink-3">
                      {s.views ? `${s.views}× geöffnet, zuletzt ${fmtDateTime(s.lastViewedAt)}` : 'noch nicht geöffnet'} · erstellt {fmtDate(s.createdAt)} von {s.createdBy}
                      {s.expiresAt ? ` · bis ${fmtDate(s.expiresAt)}` : ''}
                      {!s.showDefects ? ' · ohne Mängel' : ''}
                    </p>
                  </div>
                  <Button size="sm" variant="ghost" onClick={() => revoke(s.id)}>
                    Widerrufen
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}

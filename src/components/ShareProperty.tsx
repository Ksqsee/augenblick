// Kunden-Freigabe eines Objekts: Links erstellen, kopieren, widerrufen.
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Copy, ExternalLink, Share2 } from 'lucide-react';
import { useState } from 'react';
import { api, queryClient } from '../api';
import { fmtDate, fmtDateTime } from '../format';
import { Badge, Button, Field, Input, Modal, Spinner, useToast } from './ui';

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
      <Button variant="secondary" icon={<Share2 className="size-4" />} onClick={() => setOpen(true)}>
        Für Kunden freigeben
      </Button>
      {open && <ShareDialog propertyId={propertyId} propertyName={propertyName} onClose={() => setOpen(false)} />}
    </>
  );
}

function ShareDialog({ propertyId, propertyName, onClose }: { propertyId: string; propertyName: string; onClose: () => void }) {
  const toast = useToast();
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
    if (!confirm('Link widerrufen? Wer ihn hat, sieht danach nichts mehr.')) return;
    await api(`/shares/${id}`, { method: 'DELETE' });
    queryClient.invalidateQueries({ queryKey: key });
    toast('Link widerrufen');
  };
  const active = q.data?.filter((s) => !s.revokedAt && !(s.expiresAt && s.expiresAt < Date.now())) ?? [];
  return (
    <Modal title="Für Kunden freigeben" onClose={onClose}>
      <div className="flex flex-col gap-5">
        <p className="text-sm text-ink-2">
          Auftraggeber sehen über den Link ohne Konto den Prüfstatus von <b>{propertyName}</b>: Prüfquote, Fälligkeiten, letzte Prüfungen und auf Wunsch offene Mängel. Keine
          Fotos, Namen oder internen Notizen. Gültig für 1 Jahr.
        </p>
        {link ? (
          <div className="flex flex-col gap-2 rounded-xl bg-ok-soft p-3">
            <p className="text-sm font-medium text-ok">Link erstellt – jetzt kopieren, er wird nur einmal angezeigt.</p>
            <div className="flex gap-2">
              <Input readOnly aria-label="Kunden-Link" value={link} onFocus={(e) => e.target.select()} className="font-mono text-xs" />
              <Button
                variant="secondary"
                icon={<Copy className="size-4" />}
                onClick={async () => {
                  await navigator.clipboard.writeText(link).catch(() => {});
                  toast('Kopiert');
                }}
              >
                Kopieren
              </Button>
            </div>
            <a href={link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13px] font-medium text-ok hover:underline">
              Ansicht öffnen <ExternalLink className="size-3.5" />
            </a>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label="Für wen? (optional)" hint="z. B. Hausverwaltung Müller – erscheint nur hier in der Liste">
              {(id) => <Input id={id} value={label} maxLength={120} onChange={(e) => setLabel(e.target.value)} />}
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={showDefects} onChange={(e) => setShowDefects(e.target.checked)} className="size-4 accent-ink" />
              Offene Mängel anzeigen
            </label>
            <Button loading={busy} onClick={create} icon={<Share2 className="size-4" />} className="self-start">
              Link erstellen
            </Button>
          </div>
        )}
        <div>
          <p className="mb-2 text-[13px] font-semibold text-ink-2">Aktive Links</p>
          {q.isLoading ? (
            <Spinner />
          ) : !active.length ? (
            <p className="text-sm text-ink-3">Noch keine.</p>
          ) : (
            <ul className="divide-y divide-line rounded-xl border border-line">
              {active.map((s) => (
                <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className={clsx('truncate text-sm font-medium', !s.label && 'text-ink-3')}>{s.label || 'Ohne Bezeichnung'}</p>
                    <p className="truncate text-xs text-ink-3">
                      erstellt {fmtDate(s.createdAt)} von {s.createdBy} · {s.views ? `${s.views}× geöffnet, zuletzt ${fmtDateTime(s.lastViewedAt)}` : 'noch nicht geöffnet'}
                      {s.expiresAt ? ` · bis ${fmtDate(s.expiresAt)}` : ''}
                    </p>
                  </div>
                  {!s.showDefects && <Badge>ohne Mängel</Badge>}
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

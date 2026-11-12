// Einstellungen → Benachrichtigungen: Push, Ereignisse, Nicht stören, Kalender-Abo.
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Bell, CalendarPlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { inQuietHours, type QuietHours } from '../../../shared/quiet';
import { api, queryClient, useAction } from '../../api';
import { CopyField, RowDivider, SettingRow } from '../../components/admin';
import { Badge, Button, ErrorBox, Field, Input, Notice, SettingsSection, Skeleton, Switch, useToast } from '../../components/ui';
import { fmtDateTime } from '../../format';

interface NotifySettings {
  types: Record<string, string>;
  prefs: Record<string, { inApp?: boolean; push?: boolean }>;
  pushAvailable: boolean;
  vapidPublicKey: string | null;
  pushDevices: number;
  quiet: QuietHours;
}

function urlB64ToUint8Array(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function NotificationsTab() {
  const q = useQuery({ queryKey: ['notify-settings'], queryFn: () => api<NotifySettings>('/notifications/settings') });
  if (q.isLoading)
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  if (q.error || !q.data) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  return (
    <div>
      <PushSection data={q.data} />
      <EventsSection data={q.data} />
      <QuietSection initial={q.data.quiet} />
      <CalendarSection />
    </div>
  );
}

function PushSection({ data }: { data: NotifySettings }) {
  const toast = useToast();
  const [state, setState] = useState<'unknown' | 'on' | 'off' | 'unsupported' | 'denied'>('unknown');
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return setState('unsupported');
    if (Notification.permission === 'denied') return setState('denied');
    navigator.serviceWorker.getRegistration().then(async (r) => setState((await r?.pushManager.getSubscription()) ? 'on' : 'off'));
  }, []);
  const enable = async () => {
    try {
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return setState('denied');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(data.vapidPublicKey!) });
      await api('/push/subscribe', { body: sub.toJSON() });
      setState('on');
      queryClient.invalidateQueries({ queryKey: ['notify-settings'] });
      toast('Push aktiviert');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Push nicht möglich', 'bad');
    }
  };
  const disable = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    setState('off');
    queryClient.invalidateQueries({ queryKey: ['notify-settings'] });
  };
  const devices = `${data.pushDevices} ${data.pushDevices === 1 ? 'Gerät' : 'Geräte'} mit Push in deinem Konto`;
  return (
    <SettingsSection title="Push auf diesem Gerät" description="Meldungen auch bei geschlossener App – auf Handy und Desktop.">
      {!data.pushAvailable ? (
        <Notice tone="muted">Push ist auf dem Server nicht eingerichtet.</Notice>
      ) : state === 'unsupported' ? (
        <Notice tone="info">Dieser Browser kann keine Push-Nachrichten. Auf dem iPhone die App zuerst zum Home-Bildschirm hinzufügen.</Notice>
      ) : state === 'denied' ? (
        <Notice tone="warn">Benachrichtigungen sind im Browser blockiert. Erlaube sie in den Website-Einstellungen.</Notice>
      ) : (
        <SettingRow
          title={
            <span className="flex items-center gap-2">
              Push-Nachrichten
              {state === 'on' && (
                <Badge tone="ok" dot>
                  Aktiv
                </Badge>
              )}
            </span>
          }
          description={devices}
        >
          {state === 'on' ? (
            <>
              <Button variant="secondary" onClick={() => api('/push/test', { method: 'POST' }).then(() => toast('Testnachricht gesendet'))}>
                Test senden
              </Button>
              <Button variant="ghost" onClick={disable}>
                Ausschalten
              </Button>
            </>
          ) : (
            <Button icon={<Bell />} onClick={enable}>
              Push aktivieren
            </Button>
          )}
        </SettingRow>
      )}
    </SettingsSection>
  );
}

/** Ereignisse × Kanal. Jede Änderung wird sofort gespeichert. */
function EventsSection({ data }: { data: NotifySettings }) {
  const toast = useToast();
  const [prefs, setPrefs] = useState(data.prefs);
  const save = useAction(
    (next: NotifySettings['prefs']) => api('/notifications/settings', { method: 'PUT', body: next }),
    () => queryClient.invalidateQueries({ queryKey: ['notify-settings'] }),
  );
  const set = (type: string, k: 'inApp' | 'push', v: boolean) => {
    const next = { ...prefs, [type]: { ...prefs[type], [k]: v } };
    setPrefs(next);
    save.mutate(next, { onError: () => toast('Nicht gespeichert', 'bad') });
  };
  const box = 'size-[18px] cursor-pointer rounded accent-ink';
  return (
    <SettingsSection title="Worüber du informiert wirst" description="Für jedes Ereignis wählst du, ob es in der App (Glocke) und per Push kommt. Änderungen gelten sofort.">
      <div className="-mx-4 -my-4 sm:-mx-5 sm:-my-5">
        <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center border-b border-line px-4 py-2.5 text-caption font-medium text-ink-3 sm:px-5">
          <span>Ereignis</span>
          <span className="text-center">In der App</span>
          <span className="text-center">Push</span>
        </div>
        <ul className="divide-y divide-line">
          {Object.entries(data.types).map(([k, label]) => (
            <li key={k} className="grid min-h-12 grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] items-center px-4 py-2 text-body sm:px-5">
              <span className="min-w-0 pr-2">{label}</span>
              <span className="grid place-items-center">
                <input type="checkbox" aria-label={`${label} in der App`} className={box} checked={prefs[k]?.inApp !== false} onChange={(e) => set(k, 'inApp', e.target.checked)} />
              </span>
              <span className="grid place-items-center">
                <input type="checkbox" aria-label={`${label} per Push`} className={box} checked={prefs[k]?.push !== false} onChange={(e) => set(k, 'push', e.target.checked)} />
              </span>
            </li>
          ))}
        </ul>
      </div>
    </SettingsSection>
  );
}

function QuietSection({ initial }: { initial: QuietHours }) {
  const toast = useToast();
  const [f, setF] = useState<QuietHours>(initial);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || f.timeZone;
  const save = useAction(
    () => api('/notifications/quiet', { method: 'PUT', body: { ...f, timeZone: tz } }),
    () => {
      queryClient.invalidateQueries({ queryKey: ['notify-settings'] });
      toast('Gespeichert');
    },
  );
  const active = f.enabled && inQuietHours({ ...f, timeZone: tz }, Date.now());
  return (
    <SettingsSection
      title="Nicht stören"
      description="In der Ruhezeit kommen keine Push-Nachrichten. In der App siehst du weiter alles."
      footer={
        <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Speichern
        </Button>
      }
    >
      {save.error && <ErrorBox error={save.error} />}
      <Switch
        checked={f.enabled}
        onChange={(v) => setF({ ...f, enabled: v })}
        label={
          <span className="flex items-center gap-2">
            Ruhezeit verwenden
            {active && (
              <Badge tone="info" dot>
                Gerade aktiv
              </Badge>
            )}
          </span>
        }
        description={`Zeitzone ${tz.replace('_', ' ')}`}
      />
      <div className={clsx('grid grid-cols-2 gap-4 sm:max-w-sm', !f.enabled && 'opacity-60')}>
        <Field label="Von">{(id) => <Input id={id} type="time" disabled={!f.enabled} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
        <Field label="Bis">{(id) => <Input id={id} type="time" disabled={!f.enabled} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
      </div>
      <RowDivider />
      <Switch checked={f.weekends} disabled={!f.enabled} onChange={(v) => setF({ ...f, weekends: v })} label="Am Wochenende ganztägig ruhig" description="Samstag und Sonntag ohne Push." />
    </SettingsSection>
  );
}

function CalendarSection() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['calendar-feed'], queryFn: () => api<{ createdAt: number; lastFetchedAt: number | null } | null>('/account/calendar-feed') });
  const [url, setUrl] = useState<string | null>(null);
  const create = useAction(
    () => api<{ token: string }>('/account/calendar-feed', { method: 'POST', body: {} }),
    (r) => {
      setUrl(`${location.origin}/api/public/calendar/${r.token}.ics`);
      queryClient.invalidateQueries({ queryKey: ['calendar-feed'] });
    },
  );
  const off = useAction(
    () => api('/account/calendar-feed', { method: 'DELETE' }),
    () => {
      setUrl(null);
      queryClient.invalidateQueries({ queryKey: ['calendar-feed'] });
      toast('Kalender-Abo beendet');
    },
  );
  return (
    <SettingsSection
      title="Kalender-Abo"
      description="Fällige Prüfungen (je Gebäude und Tag), Begehungen und deine Aufgaben automatisch in Outlook, Google oder Apple Kalender."
    >
      {(create.error || off.error) && <ErrorBox error={create.error ?? off.error} />}
      {url ? (
        <>
          <Notice tone="info" title="Adresse nur jetzt sichtbar">
            Im Kalender „Kalender abonnieren“ bzw. „Aus dem Internet“ wählen und diese Adresse einfügen.
          </Notice>
          <CopyField label="Kalender-Adresse" value={url} />
          <a href={url.replace(/^https?:/, 'webcal:')} className="self-start text-meta font-medium text-ink underline underline-offset-4 hover:text-ink-2">
            Direkt im Kalender öffnen
          </a>
          <RowDivider />
        </>
      ) : null}
      <SettingRow
        title={q.data ? 'Abo aktiv' : 'Noch kein Abo.'}
        description={
          q.data
            ? `Seit ${fmtDateTime(q.data.createdAt)} · ${q.data.lastFetchedAt ? `zuletzt abgerufen ${fmtDateTime(q.data.lastFetchedAt)}` : 'noch nicht abgerufen'}`
            : 'Die Adresse ist persönlich. Wer sie kennt, sieht deine Termine.'
        }
      >
        {q.data ? (
          <>
            <Button variant="secondary" loading={create.isPending} onClick={() => create.mutate(undefined)}>
              Neue Adresse erzeugen
            </Button>
            <Button variant="ghost" loading={off.isPending} onClick={() => off.mutate(undefined)}>
              Abo beenden
            </Button>
          </>
        ) : (
          <Button icon={<CalendarPlus />} loading={create.isPending || q.isLoading} onClick={() => create.mutate(undefined)}>
            Kalender-Abo einrichten
          </Button>
        )}
      </SettingRow>
    </SettingsSection>
  );
}

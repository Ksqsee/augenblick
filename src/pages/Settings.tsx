import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, Bell, Copy, Download, Laptop, LogOut, Plus, RotateCcw, Smartphone, Trash2, Upload } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CATEGORY_COLORS, type AttributeField, type Checkpoint } from '../../shared/catalog';
import { buildFileName, DEFAULT_PDF_PATTERN, PDF_PLACEHOLDERS } from '../../shared/filename';
import { LEGAL_DOCS } from '../../shared/legal';
import { inQuietHours, type QuietHours } from '../../shared/quiet';
import { api, type CategoryInfo, clearMeCache, downscale, type EffectiveSchedule, fileUrl, queryClient, type SlaPolicies, uploadBlob, useAction, useCategories, useMe, useSla, useTaskLabels } from '../api';
import { CategoryIcon, COLOR_CLASSES } from '../components/CategoryIcon';
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Modal, PageHeader, Segmented, Select, Spinner, Textarea, useToast } from '../components/ui';
import { fmtDateTime } from '../format';

type Tab = 'profile' | 'notifications' | 'privacy' | 'company' | 'templates' | 'tasks' | 'activity';

export function SettingsPage() {
  const { data: me } = useMe();
  const isAdmin = me && ['owner', 'admin'].includes(me.user.role);
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) ?? 'profile';
  const options: { value: Tab; label: string }[] = [
    { value: 'profile', label: 'Profil' },
    { value: 'notifications', label: 'Benachrichtigungen' },
    { value: 'privacy', label: 'Datenschutz' },
    ...(isAdmin
      ? ([
          { value: 'company', label: 'Unternehmen' },
          { value: 'templates', label: 'Prüfvorlagen' },
          { value: 'tasks', label: 'Aufgaben' },
        ] as const)
      : []),
    { value: 'activity', label: 'Aktivität' },
  ];
  return (
    <>
      <PageHeader title="Einstellungen" />
      <Segmented className="mb-6" value={tab} onChange={(v) => setParams({ tab: v }, { replace: true })} options={options} />
      {tab === 'profile' && <Profile />}
      {tab === 'notifications' && <Notifications />}
      {tab === 'privacy' && <Privacy />}
      {tab === 'company' && <Company />}
      {tab === 'templates' && <Templates />}
      {tab === 'tasks' && <TaskSettings />}
      {tab === 'activity' && <Activity />}
    </>
  );
}

// ---------- Profil & Sitzungen ----------
function Profile() {
  const { data: me } = useMe();
  const toast = useToast();
  const [name, setName] = useState(me?.user.name ?? '');
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const saveName = useAction(() => api('/account/profile', { method: 'PATCH', body: { name } }), () => {
    queryClient.invalidateQueries({ queryKey: ['me'] });
    toast('Profil gespeichert');
  });
  const savePw = useAction(() => api('/account/profile', { method: 'PATCH', body: pw }), () => {
    setPw({ currentPassword: '', newPassword: '' });
    toast('Passwort geändert – andere Geräte wurden abgemeldet');
  });
  return (
    <div className="grid max-w-2xl gap-6">
      <Card>
        <CardHeader title="Profil" subtitle={me?.user.email} />
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            saveName.mutate(undefined);
          }}
        >
          {saveName.error && <ErrorBox error={saveName.error} />}
          <Field label="Name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
          <Button className="self-start" loading={saveName.isPending}>
            Speichern
          </Button>
        </form>
      </Card>
      <Card>
        <CardHeader title="Passwort ändern" />
        <form
          className="flex flex-col gap-4 p-5"
          onSubmit={(e) => {
            e.preventDefault();
            savePw.mutate(undefined);
          }}
        >
          {savePw.error && <ErrorBox error={savePw.error} />}
          <Field label="Aktuelles Passwort">
            {(id) => <Input id={id} type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}
          </Field>
          <Field label="Neues Passwort" hint="Mindestens 10 Zeichen">
            {(id) => (
              <Input id={id} type="password" autoComplete="new-password" minLength={10} required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
            )}
          </Field>
          <Button className="self-start" loading={savePw.isPending}>
            Passwort ändern
          </Button>
        </form>
      </Card>
      <Sessions />
      <NewWorkspace />
    </div>
  );
}

function deviceLabel(ua: string) {
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return [browser, os].filter(Boolean).join(' auf ');
}

function Sessions() {
  const toast = useToast();
  const q = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<{ id: string; createdAt: number | null; lastSeenAt: number | null; userAgent: string; current: boolean }[]>('/account/sessions'),
  });
  const end = useAction((id: string) => api(`/account/sessions/${id}`, { method: 'DELETE' }), (_, id) => toast(id === 'others' ? 'Andere Sitzungen beendet' : 'Sitzung beendet'));
  return (
    <Card>
      <CardHeader
        title="Angemeldete Geräte"
        subtitle="Sitzungen, die mit deinem Konto angemeldet sind"
        action={
          (q.data?.length ?? 0) > 1 && (
            <Button size="sm" variant="secondary" icon={<LogOut className="size-3.5" />} onClick={() => end.mutate('others')}>
              Alle anderen abmelden
            </Button>
          )
        }
      />
      {q.isLoading ? (
        <Spinner className="py-6" />
      ) : (
        <ul className="divide-y divide-line">
          {q.data?.map((s) => (
            <li key={s.id} className="flex items-center gap-3 px-5 py-3">
              {/Mobile|iPhone|Android/.test(s.userAgent) ? <Smartphone className="size-4 text-ink-3" /> : <Laptop className="size-4 text-ink-3" />}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium">
                  {deviceLabel(s.userAgent)} {s.current && <Badge tone="ok">Dieses Gerät</Badge>}
                </span>
                <span className="block text-xs text-ink-3">
                  angemeldet {fmtDateTime(s.createdAt)} · zuletzt aktiv {fmtDateTime(s.lastSeenAt)}
                </span>
              </span>
              {!s.current && (
                <Button size="sm" variant="ghost" onClick={() => end.mutate(s.id)}>
                  Abmelden
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function NewWorkspace() {
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const create = useAction(() => api('/account/workspaces', { body: { name } }), () => {
    queryClient.clear();
    navigate('/');
  });
  return (
    <Card>
      <CardHeader title="Weiteren Workspace anlegen" subtitle="Z. B. für eine zweite Firma. Du wechselst oben links zwischen Workspaces." />
      <form
        className="flex flex-col gap-3 p-5 sm:flex-row"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate(undefined);
        }}
      >
        <Input placeholder="Name des Unternehmens" required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />
        <Button loading={create.isPending}>Anlegen</Button>
      </form>
      {create.error && (
        <div className="px-5 pb-4">
          <ErrorBox error={create.error} />
        </div>
      )}
    </Card>
  );
}

// ---------- Benachrichtigungen ----------
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

function Notifications() {
  const toast = useToast();
  const q = useQuery({ queryKey: ['notify-settings'], queryFn: () => api<NotifySettings>('/notifications/settings') });
  const [prefs, setPrefs] = useState<NotifySettings['prefs']>({});
  const [pushState, setPushState] = useState<'unknown' | 'on' | 'off' | 'unsupported' | 'denied'>('unknown');
  useEffect(() => {
    if (q.data) setPrefs(q.data.prefs);
  }, [q.data]);
  useEffect(() => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return setPushState('unsupported');
    if (Notification.permission === 'denied') return setPushState('denied');
    navigator.serviceWorker.getRegistration().then(async (r) => setPushState((await r?.pushManager.getSubscription()) ? 'on' : 'off'));
  }, []);
  const save = useAction(() => api('/notifications/settings', { method: 'PUT', body: prefs }), () => toast('Gespeichert'));
  const enablePush = async () => {
    try {
      const reg = (await navigator.serviceWorker.getRegistration()) ?? (await navigator.serviceWorker.register('/sw.js'));
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return setPushState('denied');
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(q.data!.vapidPublicKey!) });
      await api('/push/subscribe', { body: sub.toJSON() });
      setPushState('on');
      toast('Push auf diesem Gerät aktiviert');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Push konnte nicht aktiviert werden', 'bad');
    }
  };
  const disablePush = async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api('/push/unsubscribe', { body: { endpoint: sub.endpoint } });
      await sub.unsubscribe();
    }
    setPushState('off');
  };
  if (q.isLoading || !q.data) return <Spinner />;
  const set = (type: string, k: 'inApp' | 'push', v: boolean) => setPrefs({ ...prefs, [type]: { ...prefs[type], [k]: v } });
  return (
    <div className="grid max-w-2xl gap-6">
      <Card>
        <CardHeader title="Push auf diesem Gerät" subtitle="Benachrichtigungen auch bei geschlossener App (Handy und Desktop)" />
        <div className="flex flex-wrap items-center gap-3 p-5 text-sm">
          {!q.data.pushAvailable ? (
            <p className="text-ink-3">Push ist auf dem Server nicht eingerichtet.</p>
          ) : pushState === 'unsupported' ? (
            <p className="text-ink-3">Dieser Browser unterstützt keine Push-Benachrichtigungen. Auf dem iPhone: App zuerst zum Home-Bildschirm hinzufügen.</p>
          ) : pushState === 'denied' ? (
            <p className="text-bad">Benachrichtigungen sind im Browser blockiert. Bitte in den Website-Einstellungen erlauben.</p>
          ) : pushState === 'on' ? (
            <>
              <Badge tone="ok" dot>
                Aktiv
              </Badge>
              <Button size="sm" variant="secondary" onClick={() => api('/push/test', { method: 'POST' }).then(() => toast('Testnachricht gesendet'))}>
                Test senden
              </Button>
              <Button size="sm" variant="ghost" onClick={disablePush}>
                Deaktivieren
              </Button>
            </>
          ) : (
            <Button size="sm" icon={<Bell className="size-3.5" />} onClick={enablePush}>
              Push aktivieren
            </Button>
          )}
          <span className="text-xs text-ink-3">{q.data.pushDevices} Geräte registriert</span>
        </div>
      </Card>
      <Card>
        <CardHeader title="Worüber du informiert wirst" />
        <table className="w-full text-sm">
          <thead className="border-b border-line text-left text-xs text-ink-3">
            <tr>
              <th className="px-5 py-2 font-medium">Ereignis</th>
              <th className="w-20 px-3 py-2 text-center font-medium">In der App</th>
              <th className="w-20 px-5 py-2 text-center font-medium">Push</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {Object.entries(q.data.types).map(([k, label]) => (
              <tr key={k}>
                <td className="px-5 py-2.5">{label}</td>
                <td className="px-3 py-2.5 text-center">
                  <input type="checkbox" aria-label={`${label} in der App`} className="size-4 accent-[var(--color-brand)]" checked={prefs[k]?.inApp !== false} onChange={(e) => set(k, 'inApp', e.target.checked)} />
                </td>
                <td className="px-5 py-2.5 text-center">
                  <input type="checkbox" aria-label={`${label} per Push`} className="size-4 accent-[var(--color-brand)]" checked={prefs[k]?.push !== false} onChange={(e) => set(k, 'push', e.target.checked)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-line p-4">
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Speichern
          </Button>
        </div>
      </Card>
      <QuietCard initial={q.data.quiet} />
    </div>
  );
}

/** „Nicht stören“: in diesem Zeitraum kein Push, In-App-Benachrichtigungen kommen weiter an. */
function QuietCard({ initial }: { initial: QuietHours }) {
  const toast = useToast();
  const [f, setF] = useState<QuietHours>(initial);
  const save = useAction(
    () => api('/notifications/quiet', { method: 'PUT', body: { ...f, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || f.timeZone } }),
    () => {
      queryClient.invalidateQueries({ queryKey: ['notify-settings'] });
      toast('Gespeichert');
    },
  );
  const active = inQuietHours({ ...f, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || f.timeZone }, Date.now());
  return (
    <Card>
      <CardHeader
        title="Nicht stören"
        subtitle="Im Ruhezeitraum kommen keine Push-Nachrichten. In der App siehst du alles wie gewohnt."
        action={f.enabled && active ? <Badge tone="info">Gerade aktiv</Badge> : undefined}
      />
      <div className="flex flex-col gap-4 p-5">
        {save.error && <ErrorBox error={save.error} />}
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--color-brand)]" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          Ruhezeit verwenden
        </label>
        <div className="grid grid-cols-2 gap-4 sm:max-w-sm">
          <Field label="Von">{(id) => <Input id={id} type="time" disabled={!f.enabled} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />}</Field>
          <Field label="Bis">{(id) => <Input id={id} type="time" disabled={!f.enabled} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />}</Field>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--color-brand)]" disabled={!f.enabled} checked={f.weekends} onChange={(e) => setF({ ...f, weekends: e.target.checked })} />
          Am Wochenende ganztägig ruhig
        </label>
        <div>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Speichern
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------- Datenschutz ----------
function Privacy() {
  const navigate = useNavigate();
  const history = useQuery({ queryKey: ['legal-history'], queryFn: () => api<{ doc: string; version: string; acceptedAt: number }[]>('/account/legal/history') });
  const [deleting, setDeleting] = useState(false);
  const [pw, setPw] = useState('');
  const del = useAction(() => api('/account/delete', { body: { password: pw } }), () => {
    clearMeCache();
    queryClient.clear();
    navigate('/login');
  });
  return (
    <div className="grid max-w-2xl gap-6">
      <Card>
        <CardHeader title="Meine Daten" subtitle="Auskunft und Datenübertragbarkeit (Art. 15 und 20 DSGVO)" />
        <div className="p-5">
          <a href="/api/account/export" download>
            <Button variant="secondary" icon={<Download className="size-4" />}>
              Meine Daten herunterladen (JSON)
            </Button>
          </a>
        </div>
      </Card>
      <Card>
        <CardHeader title="Rechtstexte" subtitle="Aktuelle Fassungen und deine Bestätigungen" />
        <ul className="divide-y divide-line">
          {LEGAL_DOCS.map((d) => {
            const ack = history.data?.find((h) => h.doc === d.key && h.version === d.version);
            return (
              <li key={d.key} className="flex items-center gap-3 px-5 py-3 text-sm">
                <a href={`/rechtliches/${d.key}`} target="_blank" rel="noreferrer" className="flex-1 font-medium hover:underline">
                  {d.title} <span className="font-normal text-ink-3">· Version {d.version}</span>
                </a>
                {ack ? <span className="text-xs text-ink-3">bestätigt {fmtDateTime(ack.acceptedAt)}</span> : <Badge tone="warn">offen</Badge>}
              </li>
            );
          })}
        </ul>
        {history.data && history.data.length > 0 && (
          <details className="border-t border-line px-5 py-3 text-sm">
            <summary className="cursor-pointer text-ink-2">Bestätigungs-Historie ({history.data.length})</summary>
            <ul className="mt-2 space-y-1 text-xs text-ink-3">
              {history.data.map((h, i) => (
                <li key={i}>
                  {fmtDateTime(h.acceptedAt)} · {LEGAL_DOCS.find((d) => d.key === h.doc)?.title ?? h.doc} · Version {h.version}
                </li>
              ))}
            </ul>
          </details>
        )}
      </Card>
      <Card className="border-bad/30">
        <CardHeader title="Konto löschen" subtitle="Personenbezogene Daten werden gelöscht. Prüfprotokolle bleiben als Nachweis für den Betreiber erhalten und zeigen „Gelöschte Person“." />
        <div className="p-5">
          <Button variant="danger" icon={<Trash2 className="size-4" />} onClick={() => setDeleting(true)}>
            Konto löschen
          </Button>
        </div>
      </Card>
      {deleting && (
        <Modal
          title="Konto endgültig löschen?"
          onClose={() => setDeleting(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(false)}>
                Abbrechen
              </Button>
              <Button variant="danger" loading={del.isPending} disabled={!pw} onClick={() => del.mutate(undefined)}>
                Endgültig löschen
              </Button>
            </>
          }
        >
          {del.error && <ErrorBox error={del.error} />}
          <Field label="Passwort zur Bestätigung" className="mt-3">
            {(id) => <Input id={id} type="password" value={pw} onChange={(e) => setPw(e.target.value)} />}
          </Field>
        </Modal>
      )}
    </div>
  );
}

// ---------- Unternehmen ----------
function Company() {
  const { data: me } = useMe();
  const toast = useToast();
  const t = me!.tenant;
  const [f, setF] = useState({ name: t.name, address: t.address, phone: t.phone, email: t.email, website: t.website, pdfPattern: t.pdfPattern || DEFAULT_PDF_PATTERN });
  const [archive, setArchive] = useState<number | ''>(t.archiveAfterMonths ?? '');
  const [logoKey, setLogoKey] = useState<string | null>(t.logoKey);
  const [uploading, setUploading] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const save = useAction(
    () => api('/account/company', { method: 'PATCH', body: { ...f, logoKey, archiveAfterMonths: archive === '' ? null : Number(archive) } }),
    () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      toast('Gespeichert');
    },
  );
  const preview = buildFileName(f.pdfPattern, {
    datum: new Date().toISOString().slice(0, 10),
    code: 'FST-7K2M',
    art: 'Feuerschutztür',
    pruefart: 'Jährliche Prüfung',
    objekt: 'Grundschule Am Park',
    gebaeude: 'Haupthaus',
    standort: 'Treppenhaus Nord',
    ergebnis: 'Ohne Mängel',
  });
  return (
    <form
      className="grid max-w-2xl gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      {save.error && <ErrorBox error={save.error} />}
      <Card>
        <CardHeader title="Firmenprofil" subtitle="Erscheint im Kopf aller Protokolle und Berichte" />
        <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2">
          <div className="flex items-center gap-4 sm:col-span-2">
            <div className="grid h-16 w-32 place-items-center overflow-hidden rounded-lg border border-dashed border-line-strong bg-sunken">
              {logoKey ? <img src={fileUrl(logoKey)} alt="Logo" className="max-h-14 max-w-28 object-contain" /> : <span className="text-xs text-ink-3">Kein Logo</span>}
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="secondary" loading={uploading} icon={<Upload className="size-3.5" />} onClick={() => ref.current?.click()}>
                Logo hochladen
              </Button>
              {logoKey && (
                <Button type="button" size="sm" variant="ghost" onClick={() => setLogoKey(null)}>
                  Entfernen
                </Button>
              )}
            </div>
            <input
              ref={ref}
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setUploading(true);
                try {
                  // PNG behalten (Transparenz), sonst verkleinern
                  setLogoKey(await uploadBlob(file.type === 'image/png' && file.size < 1_500_000 ? file : await downscale(file, 800)));
                } catch (x) {
                  toast(x instanceof Error ? x.message : 'Upload fehlgeschlagen', 'bad');
                } finally {
                  setUploading(false);
                }
              }}
            />
          </div>
          <Field label="Firmenname" className="sm:col-span-2">
            {(id) => <Input id={id} required value={f.name} onChange={set('name')} />}
          </Field>
          <Field label="Anschrift" className="sm:col-span-2">
            {(id) => <Textarea id={id} className="min-h-16" value={f.address} onChange={set('address')} />}
          </Field>
          <Field label="Telefon">{(id) => <Input id={id} value={f.phone} onChange={set('phone')} />}</Field>
          <Field label="E-Mail">{(id) => <Input id={id} type="email" value={f.email} onChange={set('email')} />}</Field>
          <Field label="Website" className="sm:col-span-2">
            {(id) => <Input id={id} value={f.website} onChange={set('website')} />}
          </Field>
        </div>
      </Card>
      <Card>
        <CardHeader title="PDF-Dateinamen" subtitle="Gilt für alle Prüfprotokolle, je Objekt überschreibbar" />
        <div className="flex flex-col gap-3 p-5">
          <Input value={f.pdfPattern} onChange={set('pdfPattern')} className="font-mono" />
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(PDF_PLACEHOLDERS).map(([k, label]) => (
              <button key={k} type="button" title={label} onClick={() => setF({ ...f, pdfPattern: `${f.pdfPattern}_{${k}}` })} className="rounded-md bg-sunken px-2 py-1 font-mono text-xs hover:bg-line">
                {`{${k}}`}
              </button>
            ))}
          </div>
          <p className="text-xs text-ink-3">
            Beispiel: <span className="font-mono text-ink-2">{preview}</span>
          </p>
        </div>
      </Card>
      <Card>
        <CardHeader title="Automatische Archivierung" subtitle="Ältere Prüfungen verschwinden aus den Listen, bleiben aber als Nachweis im Archiv. Die jeweils neueste Prüfung bleibt immer aktiv." />
        <div className="flex items-center gap-3 p-5 text-sm">
          <Select value={archive} onChange={(e) => setArchive(e.target.value === '' ? '' : Number(e.target.value))} className="w-60">
            <option value="">Nie automatisch archivieren</option>
            {[12, 24, 36, 60, 120].map((m) => (
              <option key={m} value={m}>
                nach {m / 12} {m === 12 ? 'Jahr' : 'Jahren'}
              </option>
            ))}
          </Select>
        </div>
      </Card>
      <div className="flex gap-3">
        <Button loading={save.isPending}>Speichern</Button>
        <a href="/api/export/backup.json" download>
          <Button type="button" variant="secondary" icon={<Download className="size-4" />}>
            JSON-Backup
          </Button>
        </a>
      </div>
    </form>
  );
}

// ---------- Prüfvorlagen & eigene Typen ----------
function Templates() {
  const { data, isLoading, error } = useCategories();
  const [open, setOpen] = useState<string | null>(null);
  const [editType, setEditType] = useState<Partial<CategoryInfo> | null>(null);
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-2xl text-sm text-ink-3">
          Passe Prüfpunkte und Intervalle je Prüfart an oder lege eigene Elementarten an (z. B. Rauchschutzvorhänge, RWA-Anlagen). Änderungen gelten für neue Prüfungen.
        </p>
        <Button icon={<Plus className="size-4" />} onClick={() => setEditType({})}>
          Eigene Elementart
        </Button>
      </div>
      {editType && <CategoryEditor initial={editType} onClose={() => setEditType(null)} />}
      {data.map((t) => (
        <Card key={t.key}>
          <div className="flex items-center gap-3 px-5 py-4">
            <button className="flex flex-1 items-center gap-3 text-left" onClick={() => setOpen(open === t.key ? null : t.key)} aria-expanded={open === t.key}>
              <CategoryIcon category={t.key} size="sm" />
              <span className="flex-1">
                <span className="block text-sm font-semibold">
                  {t.label} <span className="font-mono text-xs font-normal text-ink-3">{t.prefix}</span>
                </span>
                <span className="block text-xs text-ink-3">
                  {t.schedulesEffective.map((s) => `${s.label} (${s.intervalMonths} Mon.)`).join(' · ')}
                  {t.norm && ` · ${t.norm}`}
                </span>
              </span>
            </button>
            {t.custom && <Badge tone="info">Eigene Art</Badge>}
            {t.customized && !t.custom && <Badge tone="brand">Angepasst</Badge>}
            <Button
              size="sm"
              variant="ghost"
              title="Als neue Elementart kopieren"
              aria-label={`${t.label} als Variante kopieren`}
              onClick={() =>
                setEditType({
                  label: `${t.label} (Variante)`,
                  plural: `${t.plural} (Variante)`,
                  norm: t.norm,
                  intervalMonths: t.intervalMonths,
                  checkpoints: t.checkpoints,
                  attributes: t.attributes,
                  maintenance: t.maintenance,
                  color: t.color ?? 'slate',
                  base: t.key,
                })
              }
            >
              <Copy className="size-4" />
            </Button>
            {t.custom && (
              <Button size="sm" variant="secondary" onClick={() => setEditType(t)}>
                Bearbeiten
              </Button>
            )}
          </div>
          {open === t.key && <ScheduleTemplates category={t} />}
        </Card>
      ))}
    </div>
  );
}

function ScheduleTemplates({ category }: { category: CategoryInfo }) {
  const [key, setKey] = useState(category.schedulesEffective[0].key);
  const sched = category.schedulesEffective.find((s) => s.key === key) ?? category.schedulesEffective[0];
  return (
    <div className="border-t border-line p-5">
      {category.schedulesEffective.length > 1 && (
        <Segmented className="mb-4" value={key} onChange={setKey} options={category.schedulesEffective.map((s) => ({ value: s.key, label: s.label }))} />
      )}
      <TemplateEditor key={`${category.key}:${sched.key}`} category={category.key} schedule={sched} />
    </div>
  );
}

function CheckpointList({ items, onChange }: { items: Checkpoint[]; onChange: (v: Checkpoint[]) => void }) {
  const move = (i: number, d: number) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  return (
    <>
      <ol className="flex flex-col gap-2">
        {items.map((cp, i) => (
          <li key={cp.id} className="flex items-center gap-2">
            <span className="w-6 text-right text-xs text-ink-3 tabular-nums">{i + 1}</span>
            <Input value={cp.label} aria-label={`Prüfpunkt ${i + 1}`} onChange={(e) => onChange(items.map((x) => (x.id === cp.id ? { ...x, label: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" aria-label="Nach oben" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" aria-label="Nach unten" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" aria-label="Entfernen" onClick={() => onChange(items.filter((x) => x.id !== cp.id))}>
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ol>
      <Button className="mt-3" type="button" variant="secondary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => onChange([...items, { id: `c${Date.now().toString(36)}`, label: '' }])}>
        Prüfpunkt
      </Button>
    </>
  );
}

function TemplateEditor({ category, schedule }: { category: string; schedule: EffectiveSchedule }) {
  const toast = useToast();
  const [items, setItems] = useState<Checkpoint[]>(schedule.checkpoints);
  const [interval, setIntervalMonths] = useState(schedule.intervalMonths);
  const qs = `?schedule=${schedule.key}`;
  const save = useAction(
    () =>
      api(`/templates/${category}${qs}`, {
        method: 'PUT',
        body: { intervalMonths: interval, checkpoints: items.filter((i) => i.label.trim()).map((i) => ({ ...i, label: i.label.trim() })) },
      }),
    () => toast('Vorlage gespeichert'),
  );
  const reset = useAction(() => api(`/templates/${category}${qs}`, { method: 'DELETE' }), () => toast('Auf Standard zurückgesetzt'));
  return (
    <div>
      {save.error && <ErrorBox error={save.error} />}
      <Field label="Prüfintervall (Monate)" className="mb-4 max-w-48">
        {(id) => <Input id={id} type="number" min={1} max={240} value={interval} onChange={(e) => setIntervalMonths(Number(e.target.value))} />}
      </Field>
      <CheckpointList items={items} onChange={setItems} />
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {schedule.customized && (
          <Button variant="ghost" size="sm" icon={<RotateCcw className="size-3.5" />} loading={reset.isPending} onClick={() => reset.mutate(undefined)}>
            Standard
          </Button>
        )}
        <Button size="sm" loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Speichern
        </Button>
      </div>
    </div>
  );
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || `f${Date.now().toString(36)}`;

function CategoryEditor({ initial, onClose }: { initial: Partial<CategoryInfo>; onClose: () => void }) {
  const toast = useToast();
  const editing = !!initial.key && !!initial.custom;
  const [f, setF] = useState({
    label: initial.label ?? '',
    plural: initial.plural ?? '',
    prefix: editing ? (initial.prefix ?? '') : '',
    norm: initial.norm ?? '',
    intervalMonths: initial.intervalMonths ?? 12,
    color: initial.color ?? 'slate',
  });
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>(initial.checkpoints?.length ? initial.checkpoints : [{ id: 'p1', label: '' }]);
  const [attributes, setAttributes] = useState<AttributeField[]>(initial.attributes ?? []);
  const [maintenance, setMaintenance] = useState<{ key: string; label: string }[]>(initial.maintenance ?? []);
  const body = () => ({
    ...f,
    checkpoints: checkpoints.filter((c) => c.label.trim()).map((c) => ({ ...c, label: c.label.trim() })),
    attributes: attributes.filter((a) => a.label.trim()).map((a) => ({ ...a, key: a.key || slug(a.label), options: a.type === 'select' ? a.options : undefined })),
    maintenance: maintenance.filter((m) => m.label.trim()).map((m) => ({ ...m, key: m.key || slug(m.label) })),
    base: initial.base ?? null,
  });
  const save = useAction(
    () => (editing ? api(`/categories/${initial.key}`, { method: 'PATCH', body: body() }) : api('/categories', { body: body() })),
    () => {
      toast(editing ? 'Gespeichert' : 'Elementart angelegt');
      onClose();
    },
  );
  const del = useAction(
    () => api(`/categories/${initial.key}`, { method: 'DELETE' }),
    () => {
      toast('Elementart gelöscht');
      onClose();
    },
  );
  const sec = (title: string, children: ReactNode) => (
    <div className="border-t border-line pt-4">
      <p className="mb-3 text-[13px] font-semibold text-ink-2">{title}</p>
      {children}
    </div>
  );
  return (
    <Modal
      wide
      title={editing ? `${initial.label} bearbeiten` : initial.base ? 'Variante anlegen' : 'Eigene Elementart'}
      onClose={onClose}
      footer={
        <>
          {editing && (
            <Button variant="ghost" className="mr-auto text-bad" onClick={() => confirm('Elementart löschen? Nur möglich, wenn keine Elemente dieser Art existieren.') && del.mutate(undefined)}>
              Löschen
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Abbrechen
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {(save.error || del.error) && <ErrorBox error={save.error ?? del.error} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Bezeichnung">{(id) => <Input id={id} value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })} placeholder="z. B. Rauchschutzvorhang" />}</Field>
          <Field label="Mehrzahl">{(id) => <Input id={id} value={f.plural} onChange={(e) => setF({ ...f, plural: e.target.value })} placeholder="z. B. Rauchschutzvorhänge" />}</Field>
          <Field label="Code-Präfix" hint="2–5 Zeichen, z. B. RSV">
            {(id) => <Input id={id} value={f.prefix} maxLength={5} className="font-mono uppercase" onChange={(e) => setF({ ...f, prefix: e.target.value.toUpperCase() })} />}
          </Field>
          <Field label="Prüfintervall (Monate)">{(id) => <Input id={id} type="number" min={1} max={240} value={f.intervalMonths} onChange={(e) => setF({ ...f, intervalMonths: Number(e.target.value) })} />}</Field>
          <Field label="Norm / Grundlage" className="sm:col-span-2">
            {(id) => <Input id={id} value={f.norm} onChange={(e) => setF({ ...f, norm: e.target.value })} placeholder="z. B. DIN EN 12101-1" />}
          </Field>
          <div className="sm:col-span-2">
            <p className="mb-2 text-[13px] font-medium text-ink-2">Farbe</p>
            <div className="flex gap-2">
              {CATEGORY_COLORS.map((c) => (
                <button key={c} type="button" aria-label={c} aria-pressed={f.color === c} onClick={() => setF({ ...f, color: c })} className={clsx('size-8 rounded-lg', COLOR_CLASSES[c], f.color === c && 'ring-2 ring-ink ring-offset-2')} />
              ))}
            </div>
          </div>
        </div>
        {sec('Prüfpunkte', <CheckpointList items={checkpoints} onChange={setCheckpoints} />)}
        {sec(
          'Stammdatenfelder',
          <div className="flex flex-col gap-2">
            {attributes.map((a, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <Input className="min-w-40 flex-1" placeholder="Feldname" value={a.label} onChange={(e) => setAttributes(attributes.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Select className="w-36" value={a.type ?? 'text'} onChange={(e) => setAttributes(attributes.map((x, j) => (j === i ? { ...x, type: e.target.value as AttributeField['type'] } : x)))}>
                  <option value="text">Text</option>
                  <option value="number">Zahl</option>
                  <option value="date">Datum</option>
                  <option value="boolean">Ja/Nein</option>
                  <option value="select">Auswahl</option>
                </Select>
                {a.type === 'select' && (
                  <Input
                    className="min-w-48 flex-1"
                    placeholder="Optionen, durch Komma getrennt"
                    value={(a.options ?? []).join(', ')}
                    onChange={(e) => setAttributes(attributes.map((x, j) => (j === i ? { ...x, options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) } : x)))}
                  />
                )}
                <Button size="sm" variant="ghost" aria-label="Feld entfernen" onClick={() => setAttributes(attributes.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" className="self-start" icon={<Plus className="size-3.5" />} onClick={() => setAttributes([...attributes, { key: '', label: '', type: 'text' }])}>
              Feld
            </Button>
          </div>,
        )}
        {sec(
          'Wartungsarbeiten (zum Abhaken)',
          <div className="flex flex-col gap-2">
            {maintenance.map((m, i) => (
              <div key={i} className="flex gap-2">
                <Input placeholder="z. B. Antrieb geschmiert" value={m.label} onChange={(e) => setMaintenance(maintenance.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                <Button size="sm" variant="ghost" aria-label="Entfernen" onClick={() => setMaintenance(maintenance.filter((_, j) => j !== i))}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button type="button" variant="secondary" size="sm" className="self-start" icon={<Plus className="size-3.5" />} onClick={() => setMaintenance([...maintenance, { key: '', label: '' }])}>
              Arbeit
            </Button>
          </div>,
        )}
      </div>
    </Modal>
  );
}

// ---------- Aufgaben: Labels & SLA ----------
const LABEL_COLORS = CATEGORY_COLORS;

function TaskSettings() {
  return (
    <div className="grid max-w-2xl gap-6">
      <LabelsCard />
      <SlaCard />
    </div>
  );
}

function LabelsCard() {
  const { data } = useTaskLabels();
  const toast = useToast();
  const [name, setName] = useState('');
  const [color, setColor] = useState<string>('blue');
  const add = useAction(() => api('/tasks/labels', { body: { name, color } }), () => {
    setName('');
    toast('Label angelegt');
  });
  const del = useAction((id: string) => api(`/tasks/labels/${id}`, { method: 'DELETE' }), () => toast('Label gelöscht'));
  return (
    <Card>
      <CardHeader title="Labels" subtitle="Zum Gruppieren und Filtern von Aufgaben" />
      <ul className="divide-y divide-line">
        {data?.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-5 py-2.5">
            <span className={clsx('rounded-full px-2.5 py-0.5 text-xs font-medium', COLOR_CLASSES[l.color])}>{l.name}</span>
            <span className="flex-1 text-xs text-ink-3">{l.used} Aufgaben</span>
            <Button size="sm" variant="ghost" aria-label={`${l.name} löschen`} onClick={() => confirm(`Label „${l.name}“ löschen?`) && del.mutate(l.id)}>
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      <form
        className="flex flex-wrap items-center gap-2 border-t border-line p-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (name.trim()) add.mutate(undefined);
        }}
      >
        <Input className="min-w-40 flex-1" placeholder="Neues Label" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex gap-1">
          {LABEL_COLORS.map((c) => (
            <button key={c} type="button" aria-label={c} aria-pressed={color === c} onClick={() => setColor(c)} className={clsx('size-6 rounded-full', COLOR_CLASSES[c], color === c && 'ring-2 ring-ink ring-offset-1')} />
          ))}
        </div>
        <Button size="md" loading={add.isPending}>
          Hinzufügen
        </Button>
      </form>
    </Card>
  );
}

function SlaCard() {
  const { data } = useSla();
  const toast = useToast();
  const [f, setF] = useState<SlaPolicies | null>(null);
  useEffect(() => {
    if (data) setF(data);
  }, [data]);
  const save = useAction(() => api('/tasks/sla-policies', { method: 'PUT', body: f }), () => toast('SLA-Richtlinien gespeichert'));
  if (!f) return <Spinner />;
  const PR = { high: 'Hoch', medium: 'Mittel', low: 'Niedrig' } as const;
  return (
    <Card>
      <CardHeader title="SLA-Richtlinien" subtitle="Reaktions- und Lösungszeiten je Priorität (in Stunden). Neue Aufgaben ohne Fälligkeit bekommen die Lösungsfrist als Termin." />
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-xs text-ink-3">
          <tr>
            <th className="px-5 py-2 font-medium">Priorität</th>
            <th className="px-3 py-2 font-medium">Reaktion (h)</th>
            <th className="px-5 py-2 font-medium">Lösung (h)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {(['high', 'medium', 'low'] as const).map((p) => (
            <tr key={p}>
              <td className="px-5 py-2.5 font-medium">{PR[p]}</td>
              <td className="px-3 py-2.5">
                <Input type="number" min={1} aria-label={`Reaktion ${PR[p]}`} value={f[p].responseHours} onChange={(e) => setF({ ...f, [p]: { ...f[p], responseHours: Number(e.target.value) } })} className="h-9 w-28" />
              </td>
              <td className="px-5 py-2.5">
                <Input type="number" min={1} aria-label={`Lösung ${PR[p]}`} value={f[p].resolutionHours} onChange={(e) => setF({ ...f, [p]: { ...f[p], resolutionHours: Number(e.target.value) } })} className="h-9 w-28" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="border-t border-line p-4">
        {save.error && <ErrorBox error={save.error} />}
        <Button loading={save.isPending} onClick={() => save.mutate(undefined)}>
          Speichern
        </Button>
      </div>
    </Card>
  );
}

// ---------- Aktivität ----------
function Activity() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['activity'],
    queryFn: () => api<{ id: string; summary: string; createdAt: number; userName: string | null }[]>('/account/activity'),
  });
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBox error={error} />;
  return (
    <Card className="divide-y divide-line">
      {data?.length ? (
        data.map((a) => (
          <div key={a.id} className="flex flex-col gap-0.5 px-5 py-3 text-sm sm:flex-row sm:items-center sm:gap-3">
            <span className="flex-1">{a.summary}</span>
            <span className="text-xs text-ink-3">
              {a.userName ?? 'extern'} · {fmtDateTime(a.createdAt)}
            </span>
          </div>
        ))
      ) : (
        <p className="px-5 py-6 text-sm text-ink-3">Noch keine Aktivität.</p>
      )}
    </Card>
  );
}

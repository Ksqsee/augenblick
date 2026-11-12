// Einstellungen → Konto: Profil, Passwort, Geräte, Anmeldeverlauf, Daten und Rechtstexte, Konto löschen.
import { useQuery } from '@tanstack/react-query';
import { Download, ExternalLink, Laptop, LogOut, Smartphone, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { deviceLabel } from '../../../shared/device';
import { LEGAL_DOCS } from '../../../shared/legal';
import { api, clearMeCache, queryClient, useAction, useMe } from '../../api';
import { RowDivider, SettingRow } from '../../components/admin';
import { Badge, Button, ErrorBox, Field, Input, Modal, Notice, SettingsSection, Skeleton, StatusDot, useConfirm, useToast } from '../../components/ui';
import { fmtDateTime } from '../../format';

export function AccountTab({ focus }: { focus?: 'privacy' }) {
  useEffect(() => {
    if (focus === 'privacy') setTimeout(() => document.getElementById('datenschutz')?.scrollIntoView({ block: 'start' }), 50);
  }, [focus]);
  return (
    <div>
      <ProfileSection />
      <PasswordSection />
      <SessionsSection />
      <LoginHistorySection />
      <DataSection />
      <WorkspaceSection />
      <DeleteSection />
    </div>
  );
}

function ProfileSection() {
  const { data: me } = useMe();
  const toast = useToast();
  const [name, setName] = useState(me?.user.name ?? '');
  const save = useAction(
    () => api('/account/profile', { method: 'PATCH', body: { name } }),
    () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      toast('Profil gespeichert');
    },
  );
  return (
    <SettingsSection
      title="Profil"
      description="Dein Name steht auf Protokollen und in Aufgaben."
      footer={
        <Button form="profile-form" loading={save.isPending} disabled={name.trim() === (me?.user.name ?? '')}>
          Speichern
        </Button>
      }
    >
      <form id="profile-form" className="flex flex-col gap-4" onSubmit={submit(() => save.mutate(undefined))}>
        {save.error && <ErrorBox error={save.error} />}
        <Field label="Name">{(id) => <Input id={id} required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label="E-Mail" hint="Die Anmelde-Adresse kann nur der Support ändern.">
          {(id) => <Input id={id} value={me?.user.email ?? ''} readOnly disabled />}
        </Field>
      </form>
    </SettingsSection>
  );
}

function PasswordSection() {
  const toast = useToast();
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const save = useAction(
    () => api('/account/profile', { method: 'PATCH', body: pw }),
    () => {
      setPw({ currentPassword: '', newPassword: '' });
      toast('Passwort geändert');
    },
  );
  return (
    <SettingsSection
      title="Passwort"
      description="Nach dem Ändern werden alle anderen Geräte abgemeldet."
      footer={
        <Button form="password-form" loading={save.isPending} disabled={!pw.currentPassword || pw.newPassword.length < 10}>
          Passwort ändern
        </Button>
      }
    >
      <form id="password-form" className="flex flex-col gap-4" onSubmit={submit(() => save.mutate(undefined))}>
        {save.error && <ErrorBox error={save.error} />}
        <Field label="Aktuelles Passwort">
          {(id) => <Input id={id} type="password" autoComplete="current-password" required value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}
        </Field>
        <Field label="Neues Passwort" hint="Mindestens 10 Zeichen">
          {(id) => <Input id={id} type="password" autoComplete="new-password" minLength={10} required value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />}
        </Field>
      </form>
    </SettingsSection>
  );
}

const submit = (fn: () => void) => (e: React.FormEvent) => {
  e.preventDefault();
  fn();
};

const isMobile = (ua: string) => /Mobile|iPhone|Android/.test(ua);

function SessionsSection() {
  const toast = useToast();
  const q = useQuery({
    queryKey: ['sessions'],
    queryFn: () => api<{ id: string; createdAt: number | null; lastSeenAt: number | null; userAgent: string; current: boolean }[]>('/account/sessions'),
  });
  const end = useAction(
    (id: string) => api(`/account/sessions/${id}`, { method: 'DELETE' }),
    (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast(id === 'others' ? 'Andere Geräte abgemeldet' : 'Gerät abgemeldet');
    },
  );
  const sessions = [...(q.data ?? [])].sort((a, b) => Number(b.current) - Number(a.current));
  return (
    <SettingsSection
      title="Angemeldete Geräte"
      description="Hier bist du gerade angemeldet. Unbekanntes Gerät? Abmelden und Passwort ändern."
      footer={
        sessions.length > 1 && (
          <Button variant="secondary" icon={<LogOut />} loading={end.isPending && end.variables === 'others'} onClick={() => end.mutate('others')}>
            Alle anderen abmelden
          </Button>
        )
      }
    >
      {end.error && <ErrorBox error={end.error} />}
      {q.isLoading ? (
        <Skeleton className="h-12 w-full" />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <ul className="-my-1 divide-y divide-line">
          {sessions.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-3 first:pt-1 last:pb-1">
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-sunken text-ink-2 [&_svg]:size-[18px]">{isMobile(s.userAgent) ? <Smartphone /> : <Laptop />}</span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-body font-medium">
                  {deviceLabel(s.userAgent)}
                  {s.current && (
                    <Badge tone="ok" dot>
                      Dieses Gerät
                    </Badge>
                  )}
                </span>
                <span className="mt-0.5 block text-meta text-ink-3">Zuletzt aktiv {fmtDateTime(s.lastSeenAt)}<span className="max-sm:hidden"> · angemeldet {fmtDateTime(s.createdAt)}</span></span>
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
    </SettingsSection>
  );
}

function LoginHistorySection() {
  const q = useQuery({ queryKey: ['logins'], queryFn: () => api<{ at: number; success: boolean; userAgent: string; country: string }[]>('/account/logins') });
  const [all, setAll] = useState(false);
  const failed = q.data?.filter((l) => !l.success).length ?? 0;
  const rows = all ? (q.data ?? []) : (q.data ?? []).slice(0, 6);
  return (
    <SettingsSection
      title="Anmeldeverlauf"
      description={failed ? `Letzte 90 Tage – davon ${failed} fehlgeschlagene Versuche.` : 'Anmeldungen der letzten 90 Tage.'}
      footer={
        (q.data?.length ?? 0) > 6 && (
          <Button variant="ghost" onClick={() => setAll(!all)}>
            {all ? 'Weniger anzeigen' : `Alle ${q.data!.length} anzeigen`}
          </Button>
        )
      }
    >
      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <p className="text-body text-ink-3">Noch keine Anmeldungen aufgezeichnet.</p>
      ) : (
        <ul className="-my-1 divide-y divide-line">
          {rows.map((l, i) => (
            <li key={i} className="flex items-center gap-3 py-2.5 text-body first:pt-1 last:pb-1">
              <StatusDot tone={l.success ? 'ok' : 'bad'} label={l.success ? 'Erfolgreich' : 'Fehlgeschlagen'} />
              <span className="min-w-0 flex-1 truncate">
                {deviceLabel(l.userAgent)}
                {l.country && <span className="text-ink-3"> · {l.country}</span>}
              </span>
              {!l.success && <Badge tone="bad">Fehlgeschlagen</Badge>}
              <span className="shrink-0 text-meta text-ink-3 tabular-nums">{fmtDateTime(l.at)}</span>
            </li>
          ))}
        </ul>
      )}
    </SettingsSection>
  );
}

function DataSection() {
  const history = useQuery({ queryKey: ['legal-history'], queryFn: () => api<{ doc: string; version: string; acceptedAt: number }[]>('/account/legal/history') });
  return (
    <SettingsSection
      title={
        <span id="datenschutz" className="scroll-mt-6">
          Datenschutz
        </span>
      }
      description="Auskunft und Datenübertragbarkeit nach Art. 15 und 20 DSGVO, Rechtstexte und Bestätigungen."
    >
      <SettingRow title="Meine Daten" description="Alles, was zu deiner Person gespeichert ist, als JSON-Datei.">
        <a href="/api/account/export" download className="contents">
          <Button type="button" variant="secondary" icon={<Download />}>
            Herunterladen
          </Button>
        </a>
      </SettingRow>
      <RowDivider />
      <ul className="-my-1 divide-y divide-line">
        {LEGAL_DOCS.map((d) => {
          const ack = history.data?.find((h) => h.doc === d.key && h.version === d.version);
          return (
            <li key={d.key} className="flex items-center gap-3 py-2.5 first:pt-1 last:pb-1">
              <a href={`/rechtliches/${d.key}`} target="_blank" rel="noreferrer" className="group min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-body font-medium group-hover:underline">
                  {d.title}
                  <ExternalLink className="size-3.5 text-ink-4" />
                </span>
                <span className="block text-meta text-ink-3">Version {d.version}</span>
              </a>
              {ack ? (
                <span className="shrink-0 text-meta text-ink-3">bestätigt {fmtDateTime(ack.acceptedAt)}</span>
              ) : (
                <Badge tone="warn" dot>
                  offen
                </Badge>
              )}
            </li>
          );
        })}
      </ul>
      {history.data && history.data.length > LEGAL_DOCS.length && (
        <details className="text-meta">
          <summary className="cursor-pointer text-ink-2 hover:text-ink">Frühere Bestätigungen ({history.data.length})</summary>
          <ul className="mt-2 space-y-1 text-ink-3">
            {history.data.map((h, i) => (
              <li key={i}>
                {fmtDateTime(h.acceptedAt)} · {LEGAL_DOCS.find((d) => d.key === h.doc)?.title ?? h.doc} · Version {h.version}
              </li>
            ))}
          </ul>
        </details>
      )}
    </SettingsSection>
  );
}

function WorkspaceSection() {
  const [name, setName] = useState('');
  const navigate = useNavigate();
  const create = useAction(
    () => api('/account/workspaces', { body: { name } }),
    () => {
      queryClient.clear();
      navigate('/');
    },
  );
  return (
    <SettingsSection
      title="Weiterer Workspace"
      description="Für eine zweite Firma mit eigenen Objekten und eigenem Team. Gewechselt wird unten in der Seitenleiste."
      footer={
        <Button form="workspace-form" variant="secondary" loading={create.isPending} disabled={name.trim().length < 2}>
          Workspace anlegen
        </Button>
      }
    >
      <form id="workspace-form" className="flex flex-col gap-4" onSubmit={submit(() => create.mutate(undefined))}>
        {create.error && <ErrorBox error={create.error} />}
        <Field label="Name des Unternehmens">{(id) => <Input id={id} required minLength={2} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
      </form>
    </SettingsSection>
  );
}

function DeleteSection() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [pw, setPw] = useState('');
  const [confirm, confirmEl] = useConfirm();
  const del = useAction(
    () => api('/account/delete', { body: { password: pw } }),
    () => {
      clearMeCache();
      queryClient.clear();
      navigate('/login');
    },
  );
  return (
    <SettingsSection title="Konto löschen" description="Endgültig und ohne Wiederherstellung.">
      <Notice tone="bad" title="Personenbezogene Daten werden gelöscht">
        Prüfprotokolle bleiben als Nachweis für den Betreiber erhalten und zeigen dann „Gelöschte Person“.
      </Notice>
      <div className="flex justify-end">
        <Button
          variant="danger"
          icon={<Trash2 />}
          onClick={async () => {
            if (await confirm({ title: 'Konto wirklich löschen?', text: 'Du wirst abgemeldet und kannst dich nicht mehr anmelden.', confirmLabel: 'Weiter', danger: true })) setOpen(true);
          }}
        >
          Konto löschen
        </Button>
      </div>
      {confirmEl}
      {open && (
        <Modal
          title="Konto endgültig löschen"
          description="Zur Sicherheit brauchen wir dein Passwort."
          size="sm"
          onClose={() => setOpen(false)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Abbrechen
              </Button>
              <Button variant="danger" loading={del.isPending} disabled={!pw} onClick={() => del.mutate(undefined)}>
                Endgültig löschen
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-4">
            {del.error && <ErrorBox error={del.error} />}
            <Field label="Passwort zur Bestätigung">{(id) => <Input id={id} type="password" autoFocus value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
          </div>
        </Modal>
      )}
    </SettingsSection>
  );
}

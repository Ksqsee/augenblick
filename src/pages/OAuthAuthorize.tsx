// Freigabeseite für OAuth (MCP-Clients wie Claude): Verbindung mit neuem oder vorhandenem API-Schlüssel erlauben.
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Check, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api, useMe } from '../api';
import { Logo } from '../components/Logo';
import { Button, ErrorBox, Field, Input, Spinner } from '../components/ui';

const READ = ['Objekte, Gebäude und Elemente ansehen', 'Prüfungen, Mängel, Aufgaben und Begehungen ansehen', 'Fälligkeiten und Rundgänge planen'];
const WRITE = ['Aufgaben anlegen, kommentieren und Status ändern', 'Mängel melden und als behoben markieren', 'Elemente anlegen'];

export function OAuthAuthorize() {
  const [sp] = useSearchParams();
  const loc = useLocation();
  const me = useMe();
  const p = {
    clientId: sp.get('client_id') ?? '',
    redirectUri: sp.get('redirect_uri') ?? '',
    codeChallenge: sp.get('code_challenge') ?? '',
    codeChallengeMethod: sp.get('code_challenge_method') ?? '',
    state: sp.get('state') ?? undefined,
  };
  const requested = (sp.get('scope') ?? '').split(' ');
  const [scope, setScope] = useState<'read' | 'write'>(requested.includes('read') && !requested.includes('write') ? 'read' : 'write');
  const [mode, setMode] = useState<'session' | 'key'>('session');
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const bad = sp.get('response_type') !== 'code' || p.codeChallengeMethod !== 'S256' || !p.codeChallenge || !p.clientId || !p.redirectUri;
  const client = useQuery({
    queryKey: ['oauth-client', p.clientId, p.redirectUri],
    queryFn: () => api<{ name: string; redirectHost: string }>(`/oauth/client?client_id=${encodeURIComponent(p.clientId)}&redirect_uri=${encodeURIComponent(p.redirectUri)}`),
    enabled: !bad,
    retry: false,
  });
  const loggedIn = !!me.data && !me.isError;
  const isAdmin = loggedIn && (me.data!.user.role === 'admin' || me.data!.user.role === 'owner');
  const useSession = isAdmin && mode === 'session';

  const go = async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = useSession
        ? await api<{ redirectTo: string }>('/oauth/authorize/session', { body: { ...p, scope } })
        : await api<{ redirectTo: string }>('/oauth/authorize/key', { body: { ...p, apiKey: key.trim() } });
      window.location.assign(r.redirectTo);
    } catch (x) {
      setError(x);
      setBusy(false);
    }
  };
  const cancel = () => {
    const u = new URL(p.redirectUri);
    u.searchParams.set('error', 'access_denied');
    if (p.state) u.searchParams.set('state', p.state);
    window.location.assign(u.toString());
  };

  if (bad)
    return (
      <Frame>
        <ErrorBox error={new Error('Ungültige Anfrage: Diese Seite wird von einer Anwendung geöffnet, die sich mit Prüfkompass verbinden möchte.')} />
      </Frame>
    );
  if (client.isLoading || me.isLoading) return <Spinner className="min-h-dvh items-center" />;
  if (client.error)
    return (
      <Frame>
        <ErrorBox error={client.error} />
      </Frame>
    );
  const name = client.data!.name;
  const perms = useSession ? (scope === 'write' ? [...READ, ...WRITE] : READ) : [...READ, 'Schreiben nur, wenn der Schlüssel Schreibrechte hat'];

  return (
    <Frame>
      <div className="flex items-center justify-center gap-3">
        <span className="grid size-14 place-items-center rounded-2xl bg-surface text-xl font-semibold shadow-card">{name.slice(0, 1).toUpperCase()}</span>
        <span className="flex items-center gap-1 text-ink-3" aria-hidden>
          <span className="h-px w-5 border-t border-dashed border-line-strong" />
          <span className="grid size-6 place-items-center rounded-full bg-ok text-white">
            <Check className="size-3.5" />
          </span>
          <span className="h-px w-5 border-t border-dashed border-line-strong" />
        </span>
        <span className="grid size-14 place-items-center rounded-2xl bg-surface shadow-card">
          <Logo className="[&>span]:hidden" />
        </span>
      </div>
      <h1 className="mt-5 text-center text-xl leading-snug font-semibold tracking-tight">
        <span className="text-brand-strong">{name}</span> möchte sich mit Prüfkompass verbinden
      </h1>
      {loggedIn && <p className="mt-1 text-center text-sm text-ink-3">Workspace {me.data!.tenant.name}</p>}

      <form onSubmit={go} className="mt-6 flex flex-col gap-4 rounded-2xl bg-surface p-5 shadow-card">
        {!!error && <ErrorBox error={error} />}
        {isAdmin && (
          <div role="radiogroup" aria-label="Verbindungsart" className="grid grid-cols-2 gap-1 rounded-xl bg-sunken p-1 text-sm font-medium">
            {(['session', 'key'] as const).map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={mode === m}
                onClick={() => setMode(m)}
                className={clsx('h-9 rounded-lg transition', mode === m ? 'bg-surface shadow-card' : 'text-ink-3 hover:text-ink')}
              >
                {m === 'session' ? 'Neue Verbindung' : 'Vorhandener Schlüssel'}
              </button>
            ))}
          </div>
        )}

        {useSession ? (
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Rechte">
            {(['read', 'write'] as const).map((s) => (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={scope === s}
                onClick={() => setScope(s)}
                className={clsx('rounded-xl border p-3 text-left transition', scope === s ? 'border-ink bg-ink/[0.03]' : 'border-line hover:border-line-strong')}
              >
                <span className="block text-sm font-semibold">{s === 'read' ? 'Nur lesen' : 'Lesen und schreiben'}</span>
                <span className="block text-xs text-ink-3">{s === 'read' ? 'Auswerten, planen, fragen' : 'Auch Aufgaben und Mängel anlegen'}</span>
              </button>
            ))}
          </div>
        ) : (
          <Field label="API-Schlüssel" hint="Erstellen unter Einstellungen → API. Die Verbindung hat dieselben Rechte wie der Schlüssel.">
            {(id) => <Input id={id} required autoComplete="off" spellCheck={false} placeholder="pk_…" className="font-mono text-sm" value={key} onChange={(e) => setKey(e.target.value)} />}
          </Field>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold tracking-wide text-ink-3 uppercase">{name} darf danach</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {perms.map((t) => (
              <li key={t} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-ok" />
                {t}
              </li>
            ))}
            <li className="flex gap-2 text-ink-3">
              <Lock className="mt-0.5 size-4 shrink-0" />
              Kein Zugriff auf Konto, Team, Passwörter und Einstellungen
            </li>
          </ul>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <Button type="button" variant="secondary" className="sm:flex-1" onClick={cancel}>
            Abbrechen
          </Button>
          <Button className="sm:flex-1" loading={busy} disabled={!useSession && !key.trim()} icon={<ShieldCheck className="size-4" />}>
            Verbinden
          </Button>
        </div>
        <p className="text-center text-xs text-ink-3">
          Danach geht es zurück zu <b className="font-medium text-ink-2">{client.data!.redirectHost}</b>. Trennen jederzeit unter Einstellungen → API.
        </p>
      </form>

      {!loggedIn && (
        <p className="mt-4 flex items-center justify-center gap-1.5 text-sm text-ink-3">
          <KeyRound className="size-4" />
          Lieber ohne Schlüssel?{' '}
          <Link to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} className="font-medium text-ink underline underline-offset-4">
            Anmelden
          </Link>
        </p>
      )}
      {loggedIn && !isAdmin && <p className="mt-4 text-center text-sm text-ink-3">Neue Verbindungen ohne Schlüssel können nur Admins freigeben.</p>}
    </Frame>
  );
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh items-start justify-center bg-canvas px-4 py-10 sm:items-center">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

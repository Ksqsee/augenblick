// Freigabeseite für OAuth (MCP-Clients wie Claude): Verbindung mit neuem oder vorhandenem API-Schlüssel erlauben.
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeftRight, Check, KeyRound, Lock, ShieldCheck } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api, useMe } from '../api';
import { Logo } from '../components/Logo';
import { Avatar, Button, ErrorBox, Field, Input, Spinner } from '../components/ui';

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
      <div className="flex items-center justify-center gap-3" aria-hidden>
        <span className="grid size-14 place-items-center rounded-2xl bg-surface text-xl font-semibold shadow-card">{name.slice(0, 1).toUpperCase()}</span>
        <ArrowLeftRight className="size-5 text-ink-4" />
        <span className="grid size-14 place-items-center rounded-2xl bg-surface shadow-card">
          <Logo className="[&>span]:hidden" />
        </span>
      </div>
      <h1 className="mt-6 text-center text-h3 font-semibold tracking-tight text-balance sm:text-h2">{name} möchte sich mit Prüfkompass verbinden</h1>
      <p className="mt-1.5 text-center text-meta text-ink-3">
        Danach geht es zurück zu <span className="font-medium text-ink-2">{client.data!.redirectHost}</span>
      </p>

      <form onSubmit={go} className="mt-6 overflow-hidden rounded-2xl bg-surface shadow-card">
        {loggedIn && (
          <div className="flex items-center gap-3 border-b border-line px-5 py-3">
            <Avatar name={me.data!.user.name} size="md" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium">{me.data!.user.name}</p>
              <p className="truncate text-meta text-ink-3">Workspace {me.data!.tenant.name}</p>
            </div>
          </div>
        )}
        <div className="flex flex-col gap-5 p-5">
          {!!error && <ErrorBox error={error} />}
          {isAdmin && (
            <div role="radiogroup" aria-label="Verbindungsart" className="grid grid-cols-2 gap-0.5 rounded-lg bg-sunken p-0.5 text-meta font-medium">
              {(['session', 'key'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setMode(m)}
                  className={clsx('h-9 rounded-md transition', mode === m ? 'bg-surface text-ink shadow-card' : 'text-ink-2 hover:text-ink')}
                >
                  {m === 'session' ? 'Neue Verbindung' : 'Vorhandener Schlüssel'}
                </button>
              ))}
            </div>
          )}

          {useSession ? (
            <fieldset>
              <legend className="mb-2 text-meta font-medium text-ink-2">Rechte</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Rechte">
                {(['read', 'write'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={scope === s}
                    onClick={() => setScope(s)}
                    className={clsx('flex items-start gap-2.5 rounded-xl border p-3 text-left transition', scope === s ? 'border-ink bg-canvas' : 'border-line hover:border-line-strong')}
                  >
                    <span className={clsx('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full border', scope === s ? 'border-ink bg-ink' : 'border-line-strong')}>
                      {scope === s && <span className="size-1.5 rounded-full bg-white" />}
                    </span>
                    <span>
                      <span className="block text-body font-medium">{s === 'read' ? 'Nur lesen' : 'Lesen und schreiben'}</span>
                      <span className="block text-meta text-ink-3">{s === 'read' ? 'Auswerten, planen, fragen' : 'Auch Aufgaben und Mängel anlegen'}</span>
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>
          ) : (
            <Field label="API-Schlüssel" hint="Erstellen unter Einstellungen → API. Die Verbindung hat dieselben Rechte wie der Schlüssel.">
              {(id) => <Input id={id} required autoComplete="off" spellCheck={false} placeholder="pk_…" className="font-mono" value={key} onChange={(e) => setKey(e.target.value)} />}
            </Field>
          )}

          <div className="rounded-xl border border-line">
            <p className="border-b border-line px-4 py-2.5 text-meta font-medium text-ink-2">{name} darf danach</p>
            <ul className="flex flex-col gap-2 px-4 py-3 text-body">
              {perms.map((t) => (
                <li key={t} className="flex gap-2.5">
                  <Check className="mt-0.5 size-4 shrink-0 text-ok" />
                  {t}
                </li>
              ))}
              <li className="flex gap-2.5 text-ink-3">
                <Lock className="mt-0.5 size-4 shrink-0" />
                Kein Zugriff auf Konto, Team, Passwörter und Einstellungen
              </li>
            </ul>
          </div>
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-line bg-canvas/60 px-5 py-4 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={cancel}>
            Abbrechen
          </Button>
          <Button loading={busy} disabled={!useSession && !key.trim()} icon={<ShieldCheck />}>
            Verbinden
          </Button>
        </div>
      </form>
      <p className="mt-4 text-center text-meta text-ink-3">Trennen jederzeit unter Einstellungen → API.</p>

      {!loggedIn && (
        <p className="mt-3 flex items-center justify-center gap-1.5 text-meta text-ink-3">
          <KeyRound className="size-4" />
          Lieber ohne Schlüssel?{' '}
          <Link to={`/login?next=${encodeURIComponent(loc.pathname + loc.search)}`} className="font-medium text-ink underline underline-offset-4">
            Anmelden
          </Link>
        </p>
      )}
      {loggedIn && !isAdmin && <p className="mt-3 text-center text-meta text-ink-3">Neue Verbindungen ohne Schlüssel können nur Admins freigeben.</p>}
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

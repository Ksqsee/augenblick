import { useQuery } from '@tanstack/react-query';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ROLES, type Role } from '../../shared/catalog';
import { api, queryClient } from '../api';
import { Logo } from '../components/Logo';
import { Button, ErrorBox, Field, Input, Spinner, Surface } from '../components/ui';

/**
 * Anmelden, Registrieren, Einladung, Passwort: Beton-Grund, eine weiße Fläche mit dem Formular (links im Raster,
 * nicht zentriert), daneben Leere und ein ruhiger Satz. Auf dem Handy randlos.
 */
function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas px-4 pt-5 pb-6 sm:px-10 sm:pt-8 lg:px-[8vw]">
      <Link to="/login" className="self-start" aria-label="Prüfkompass">
        <Logo />
      </Link>
      <div className="flex flex-1 flex-col justify-center py-8 lg:py-16">
        <div className="flex flex-col gap-12 lg:flex-row lg:items-end lg:justify-between">
          <main className="animate-in w-full sm:max-w-[400px]">
            <Surface className="px-5 py-7 sm:px-8 sm:py-9">
              <h1 className="text-h1 font-semibold tracking-[-0.02em]">{title}</h1>
              {subtitle && <p className="mt-1.5 text-body text-ink-2">{subtitle}</p>}
              <div className="mt-7">{children}</div>
            </Surface>
            {footer && <div className="mt-5 px-1 text-body text-ink-2">{footer}</div>}
          </main>
          <p className="hidden max-w-[22rem] border-l border-line-strong pl-5 text-h2 font-medium tracking-[-0.01em] text-ink lg:block" aria-hidden>
            Jede Tür, jede Klappe, jeder Löscher. <span className="text-ink-3">Geprüft, belegt, nachvollziehbar.</span>
          </p>
        </div>
      </div>
      <p className="px-1 text-caption text-ink-3">
        <Link to="/rechtliches/privacy" className="hover:text-ink">
          Datenschutz
        </Link>
        {' · '}
        <Link to="/rechtliches/terms" className="hover:text-ink">
          Nutzungsbedingungen
        </Link>
      </p>
    </div>
  );
}

function useSubmit(fn: () => Promise<unknown>, after: () => void) {
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await fn();
      await queryClient.invalidateQueries({ queryKey: ['me'] });
      after();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, onSubmit };
}

export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get('next');
  const { error, busy, onSubmit } = useSubmit(
    () => api('/auth/login', { body: { email, password } }),
    () => navigate(next?.startsWith('/') ? next : '/', { replace: true }),
  );
  return (
    <AuthLayout
      title="Anmelden"
      subtitle="Mit dem Konto deines Workspaces."
      footer={
        <>
          Noch kein Konto?{' '}
          <Link to="/registrieren" className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
            Workspace anlegen
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {!!error && <ErrorBox error={error} />}
        <Field label="E-Mail">{(id) => <Input id={id} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Passwort">
          {(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button size="lg" loading={busy} className="mt-2 w-full">
          Anmelden
        </Button>
        <details className="group text-meta text-ink-3">
          <summary className="cursor-pointer list-none text-ink-2 underline decoration-line-strong underline-offset-4 hover:text-ink [&::-webkit-details-marker]:hidden">Passwort vergessen?</summary>
          <p className="mt-2 border-l-2 border-line pl-3 leading-relaxed text-ink-2">
            Bitte eine Administratorin oder einen Administrator deines Workspaces, unter <b>Team</b> einen Link zum Zurücksetzen zu erzeugen. Der Link ist 24 Stunden gültig.
          </p>
        </details>
      </form>
    </AuthLayout>
  );
}

export function Register() {
  const [f, setF] = useState({ company: '', name: '', email: '', password: '' });
  const navigate = useNavigate();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const { error, busy, onSubmit } = useSubmit(
    () => api('/auth/register', { body: f }),
    () => navigate('/', { replace: true }),
  );
  return (
    <AuthLayout
      title="Workspace anlegen"
      subtitle="Ein Workspace gehört zu deinem Unternehmen. Kolleginnen und Kollegen lädst du später ein."
      footer={
        <>
          Schon registriert?{' '}
          <Link to="/login" className="font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink">
            Anmelden
          </Link>
        </>
      }
    >
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {!!error && <ErrorBox error={error} />}
        <Field label="Unternehmen">{(id) => <Input id={id} required value={f.company} onChange={set('company')} />}</Field>
        <Field label="Dein Name">{(id) => <Input id={id} autoComplete="name" required value={f.name} onChange={set('name')} />}</Field>
        <Field label="E-Mail">{(id) => <Input id={id} type="email" autoComplete="email" required value={f.email} onChange={set('email')} />}</Field>
        <Field label="Passwort" hint="Mindestens 10 Zeichen">
          {(id) => <Input id={id} type="password" autoComplete="new-password" minLength={10} required value={f.password} onChange={set('password')} />}
        </Field>
        <p className="text-caption leading-relaxed text-ink-3">
          Mit der Registrierung stimmst du den{' '}
          <Link to="/rechtliches/terms" className="underline" target="_blank">
            Nutzungsbedingungen
          </Link>
          , den{' '}
          <Link to="/rechtliches/privacy" className="underline" target="_blank">
            Datenschutzhinweisen
          </Link>{' '}
          und der{' '}
          <Link to="/rechtliches/dpa" className="underline" target="_blank">
            AVV
          </Link>{' '}
          zu.
        </p>
        <Button size="lg" loading={busy} className="mt-2 w-full">
          Kostenlos starten
        </Button>
      </form>
    </AuthLayout>
  );
}

export function InviteAccept() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const inv = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api<{ email: string; role: Role; company: string; existingUser: boolean }>(`/auth/invite/${token}`),
    retry: false,
  });
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, onSubmit } = useSubmit(
    () => api(`/auth/invite/${token}`, { body: { name: name || undefined, password } }),
    () => navigate('/', { replace: true }),
  );
  if (inv.isLoading) return <Spinner className="min-h-dvh items-center" />;
  if (inv.isError || !inv.data)
    return (
      <AuthLayout title="Einladung ungültig" subtitle="Der Link wurde bereits verwendet oder ist nicht mehr gültig.">
        <Link to="/login">
          <Button variant="secondary">Zur Anmeldung</Button>
        </Link>
      </AuthLayout>
    );
  const d = inv.data;
  return (
    <AuthLayout title={`Einladung zu ${d.company}`} subtitle={`Rolle: ${ROLES[d.role]} · ${d.email}`}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {!!error && <ErrorBox error={error} />}
        {!d.existingUser && <Field label="Dein Name">{(id) => <Input id={id} required value={name} onChange={(e) => setName(e.target.value)} />}</Field>}
        <Field label={d.existingUser ? 'Dein bestehendes Passwort' : 'Passwort festlegen'} hint={d.existingUser ? undefined : 'Mindestens 10 Zeichen'}>
          {(id) => <Input id={id} type="password" minLength={d.existingUser ? 1 : 10} required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Button size="lg" loading={busy} className="mt-2 w-full">
          Einladung annehmen
        </Button>
      </form>
    </AuthLayout>
  );
}

export function ResetPassword() {
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const info = useQuery({ queryKey: ['reset', token], queryFn: () => api<{ email: string; name: string }>(`/auth/reset/${token}`), retry: false });
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (info.isLoading) return <Spinner className="min-h-dvh items-center" />;
  if (!info.data)
    return (
      <AuthLayout title="Link ungültig" subtitle="Der Link ist abgelaufen oder wurde bereits verwendet. Bitte einen neuen Link anfordern.">
        <Link to="/login">
          <Button variant="secondary">Zur Anmeldung</Button>
        </Link>
      </AuthLayout>
    );
  if (done)
    return (
      <AuthLayout title="Passwort geändert" subtitle="Du kannst dich jetzt mit dem neuen Passwort anmelden. Alle anderen Sitzungen wurden beendet.">
        <Button onClick={() => navigate('/login')}>Zur Anmeldung</Button>
      </AuthLayout>
    );
  return (
    <AuthLayout title="Neues Passwort" subtitle={`${info.data.name} · ${info.data.email}`}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (password !== repeat) return setError(new Error('Die Passwörter stimmen nicht überein'));
          setBusy(true);
          setError(null);
          try {
            await api(`/auth/reset/${token}`, { body: { password } });
            setDone(true);
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
      >
        {!!error && <ErrorBox error={error} />}
        <Field label="Neues Passwort" hint="Mindestens 10 Zeichen">
          {(id) => <Input id={id} type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label="Wiederholen">
          {(id) => <Input id={id} type="password" autoComplete="new-password" minLength={10} required value={repeat} onChange={(e) => setRepeat(e.target.value)} />}
        </Field>
        <Button size="lg" loading={busy} className="mt-2 w-full">
          Passwort speichern
        </Button>
      </form>
    </AuthLayout>
  );
}

import { useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { type FormEvent, type ReactNode, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ROLES, type Role } from '../../shared/catalog';
import { api, queryClient } from '../api';
import { Logo } from '../components/Logo';
import { Button, ErrorBox, Field, Input, Spinner } from '../components/ui';

function AuthLayout({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-6 py-8 sm:px-12">
        <Logo />
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center py-10">
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-ink-3">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-6 text-sm text-ink-3">{footer}</div>}
        </div>
      </div>
      <div className="relative hidden overflow-hidden bg-ink lg:block">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,rgba(226,85,27,0.35),transparent_55%),radial-gradient(circle_at_80%_80%,rgba(226,85,27,0.18),transparent_50%)]" />
        <div className="relative flex h-full flex-col justify-end p-14 text-white">
          <p className="max-w-md text-3xl leading-tight font-semibold tracking-tight">Brandschutz-Prüfungen planen, durchführen und nachweisen – an einem Ort.</p>
          <ul className="mt-8 space-y-3 text-[15px] text-white/80">
            {['Fällige Prüfungen auf einen Blick', 'Prüfprotokolle mit Unterschrift direkt vor Ort', 'Mängel bis zur Behebung nachverfolgen', 'QR-Etiketten für jedes Element'].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <CheckCircle2 className="size-5 text-brand" /> {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
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
      title="Willkommen zurück"
      subtitle="Melde dich mit deinem Konto an."
      footer={
        <>
          Noch kein Konto?{' '}
          <Link to="/registrieren" className="font-medium text-ink underline underline-offset-4">
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
        <Button size="lg" loading={busy} className="mt-2">
          Anmelden
        </Button>
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
          <Link to="/login" className="font-medium text-ink underline underline-offset-4">
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
        <Button size="lg" loading={busy} className="mt-2">
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
        <Button size="lg" loading={busy} className="mt-2">
          Einladung annehmen
        </Button>
      </form>
    </AuthLayout>
  );
}

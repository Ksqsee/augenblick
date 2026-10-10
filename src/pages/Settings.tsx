import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Checkpoint } from '../../shared/catalog';
import { api, queryClient, type Template, useAction, useMe, useTemplates } from '../api';
import { CategoryIcon } from '../components/CategoryIcon';
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, PageHeader, Segmented, Spinner, useToast } from '../components/ui';
import { fmtDateTime } from '../format';

type Tab = 'profile' | 'company' | 'templates' | 'activity';

export function SettingsPage() {
  const { data: me } = useMe();
  const isAdmin = me && ['owner', 'admin'].includes(me.user.role);
  const [tab, setTab] = useState<Tab>('profile');
  return (
    <>
      <PageHeader title="Einstellungen" />
      <Segmented
        className="mb-6"
        value={tab}
        onChange={setTab}
        options={[
          { value: 'profile', label: 'Profil' },
          ...(isAdmin
            ? ([
                { value: 'company', label: 'Unternehmen' },
                { value: 'templates', label: 'Prüfvorlagen' },
              ] as const)
            : []),
          { value: 'activity', label: 'Aktivität' },
        ]}
      />
      {tab === 'profile' && <Profile />}
      {tab === 'company' && <Company />}
      {tab === 'templates' && <Templates />}
      {tab === 'activity' && <Activity />}
    </>
  );
}

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
    </div>
  );
}

function Company() {
  const { data: me } = useMe();
  const toast = useToast();
  const [name, setName] = useState(me?.tenant.name ?? '');
  const save = useAction(() => api('/account/company', { method: 'PATCH', body: { name } }), () => {
    queryClient.invalidateQueries({ queryKey: ['me'] });
    toast('Gespeichert');
  });
  return (
    <Card className="max-w-2xl">
      <CardHeader title="Unternehmen" subtitle="Erscheint auf Protokollen und Berichten" />
      <form
        className="flex flex-col gap-4 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined);
        }}
      >
        {save.error && <ErrorBox error={save.error} />}
        <Field label="Firmenname">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Button className="self-start" loading={save.isPending}>
          Speichern
        </Button>
      </form>
    </Card>
  );
}

function Templates() {
  const { data, isLoading, error } = useTemplates();
  const [open, setOpen] = useState<string | null>(null);
  if (isLoading) return <Spinner />;
  if (error || !data) return <ErrorBox error={error} />;
  return (
    <div className="flex flex-col gap-4">
      <p className="max-w-2xl text-sm text-ink-3">
        Passe Prüfpunkte und Intervalle an eure Praxis an. Änderungen gelten für neue Prüfungen – bestehende Protokolle behalten ihre Prüfpunkte.
      </p>
      {data.map((t) => (
        <Card key={t.key}>
          <button className="flex w-full items-center gap-3 px-5 py-4 text-left" onClick={() => setOpen(open === t.key ? null : t.key)}>
            <CategoryIcon category={t.key} size="sm" />
            <span className="flex-1">
              <span className="block text-sm font-semibold">{t.label}</span>
              <span className="block text-xs text-ink-3">
                {t.checkpoints.length} Prüfpunkte · alle {t.intervalMonths} Monate · {t.norm}
              </span>
            </span>
            {t.customized && <Badge tone="brand">Angepasst</Badge>}
          </button>
          {open === t.key && <TemplateEditor template={t} />}
        </Card>
      ))}
    </div>
  );
}

function TemplateEditor({ template }: { template: Template }) {
  const toast = useToast();
  const [items, setItems] = useState<Checkpoint[]>(template.checkpoints);
  const [interval, setIntervalMonths] = useState(template.intervalMonths);
  useEffect(() => {
    setItems(template.checkpoints);
    setIntervalMonths(template.intervalMonths);
  }, [template]);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['templates'] });
  const save = useAction(
    () =>
      api(`/templates/${template.key}`, {
        method: 'PUT',
        body: { intervalMonths: interval, checkpoints: items.filter((i) => i.label.trim()).map((i) => ({ ...i, label: i.label.trim() })) },
      }),
    () => {
      refresh();
      toast('Vorlage gespeichert');
    },
  );
  const reset = useAction(() => api(`/templates/${template.key}`, { method: 'DELETE' }), () => {
    refresh();
    toast('Auf Standard zurückgesetzt');
  });
  const move = (i: number, d: number) => {
    const next = [...items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    setItems(next);
  };
  return (
    <div className="border-t border-line p-5">
      {save.error && <ErrorBox error={save.error} />}
      <Field label="Prüfintervall (Monate)" className="mb-4 max-w-48">
        {(id) => <Input id={id} type="number" min={1} max={120} value={interval} onChange={(e) => setIntervalMonths(Number(e.target.value))} />}
      </Field>
      <ol className="flex flex-col gap-2">
        {items.map((cp, i) => (
          <li key={cp.id} className="flex items-center gap-2">
            <span className="w-6 text-right text-xs text-ink-3 tabular-nums">{i + 1}</span>
            <Input value={cp.label} onChange={(e) => setItems(items.map((x) => (x.id === cp.id ? { ...x, label: e.target.value } : x)))} />
            <Button size="sm" variant="ghost" aria-label="Nach oben" disabled={i === 0} onClick={() => move(i, -1)}>
              <ArrowUp className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" aria-label="Nach unten" disabled={i === items.length - 1} onClick={() => move(i, 1)}>
              <ArrowDown className="size-4" />
            </Button>
            <Button size="sm" variant="ghost" aria-label="Entfernen" onClick={() => setItems(items.filter((x) => x.id !== cp.id))}>
              <Trash2 className="size-4" />
            </Button>
          </li>
        ))}
      </ol>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setItems([...items, { id: `c${Date.now().toString(36)}`, label: '' }])}>
          Prüfpunkt
        </Button>
        <span className="flex-1" />
        {template.customized && (
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
          <div key={a.id} className="flex items-center gap-3 px-5 py-3 text-sm">
            <span className="flex-1">{a.summary}</span>
            <span className="text-xs text-ink-3">
              {a.userName} · {fmtDateTime(a.createdAt)}
            </span>
          </div>
        ))
      ) : (
        <p className="px-5 py-6 text-sm text-ink-3">Noch keine Aktivität.</p>
      )}
    </Card>
  );
}

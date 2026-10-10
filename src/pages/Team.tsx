import { Copy, Crown, KeyRound, Mail, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { ROLES, type Role } from '../../shared/catalog';
import { api, queryClient, useAction, useMe, useMembers } from '../api';
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Modal, PageHeader, Select, Spinner, useToast } from '../components/ui';
import { fmtDate } from '../format';

const ROLE_HINT: Record<Role, string> = {
  owner: 'Alle Rechte, inkl. Workspace',
  admin: 'Objekte, Team und Vorlagen verwalten',
  inspector: 'Elemente anlegen und prüfen',
  viewer: 'Nur ansehen',
};

const inviteLink = (token: string) => `${window.location.origin}/einladung/${token}`;

export function TeamPage() {
  const { data, isLoading, error } = useMembers();
  const { data: me } = useMe();
  const toast = useToast();
  const [inviting, setInviting] = useState(false);
  const isAdmin = me && ['owner', 'admin'].includes(me.user.role);
  const setRole = useAction((v: { id: string; role: Role }) => api(`/account/members/${v.id}`, { method: 'PATCH', body: { role: v.role } }), () => toast('Rolle geändert'));
  const remove = useAction((id: string) => api(`/account/members/${id}`, { method: 'DELETE' }), () => toast('Mitglied entfernt'));
  const revoke = useAction((id: string) => api(`/account/members/invite/${id}`, { method: 'DELETE' }), () => toast('Einladung zurückgezogen'));
  const [reset, setReset] = useState<{ name: string; url: string } | null>(null);
  const resetLink = useAction(
    (m: { id: string; name: string }) => api<{ token: string }>(`/account/members/${m.id}/reset-link`, { method: 'POST' }),
    (r, m) => setReset({ name: m.name, url: `${window.location.origin}/passwort/${r.token}` }),
  );
  const transfer = useAction((id: string) => api(`/account/members/${id}/transfer-ownership`, { method: 'POST' }), () => {
    queryClient.invalidateQueries({ queryKey: ['me'] });
    toast('Inhaberschaft übertragen');
  });
  const copy = async (token: string) => {
    await navigator.clipboard.writeText(inviteLink(token));
    toast('Einladungslink kopiert');
  };

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Wer im Workspace arbeitet und was er darf"
        actions={
          isAdmin && (
            <Button icon={<UserPlus className="size-4" />} onClick={() => setInviting(true)}>
              Einladen
            </Button>
          )
        }
      />
      {inviting && <InviteModal onClose={() => setInviting(false)} />}
      {reset && (
        <Modal title={`Passwort-Link für ${reset.name}`} onClose={() => setReset(null)} footer={<Button onClick={() => setReset(null)}>Fertig</Button>}>
          <p className="mb-3 text-sm text-ink-2">Gib diesen Link persönlich weiter. Er ist 24 Stunden und nur einmal gültig; danach werden alle Sitzungen der Person beendet.</p>
          <div className="flex gap-2">
            <Input readOnly value={reset.url} onFocus={(e) => e.target.select()} />
            <Button
              variant="secondary"
              icon={<Copy className="size-4" />}
              onClick={async () => {
                await navigator.clipboard.writeText(reset.url);
                toast('Kopiert');
              }}
            >
              Kopieren
            </Button>
          </div>
        </Modal>
      )}
      {resetLink.error && <ErrorBox error={resetLink.error} />}
      {isLoading ? (
        <Spinner />
      ) : error || !data ? (
        <ErrorBox error={error} />
      ) : (
        <div className="flex flex-col gap-6">
          <Card className="divide-y divide-line overflow-hidden">
            {data.members.map((m) => (
              <div key={m.id} className="flex flex-col gap-3 px-5 py-3.5 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sunken text-sm font-semibold text-ink-2">
                    {m.name.split(' ').map((p) => p[0]).slice(0, 2).join('')}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {m.name} {m.id === me?.user.id && <span className="font-normal text-ink-3">(du)</span>}
                    </p>
                    <p className="truncate text-xs text-ink-3">
                      {m.email} · seit {fmtDate(m.joinedAt)}
                    </p>
                  </div>
                </div>
                {isAdmin && m.role !== 'owner' && m.id !== me?.user.id ? (
                  <div className="flex gap-2">
                    <Select value={m.role} onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value as Role })} className="h-9 w-44">
                      {(['admin', 'inspector', 'viewer'] as Role[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLES[r]}
                        </option>
                      ))}
                    </Select>
                    <Button variant="ghost" size="sm" aria-label={`Passwort-Link für ${m.name}`} title="Link zum Zurücksetzen des Passworts" onClick={() => resetLink.mutate(m)}>
                      <KeyRound className="size-4" />
                    </Button>
                    {me?.user.role === 'owner' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Inhaberschaft an ${m.name} übertragen`}
                        title="Inhaberschaft übertragen"
                        onClick={() => confirm(`Inhaberschaft an ${m.name} übertragen? Du wirst Administrator/in.`) && transfer.mutate(m.id)}
                      >
                        <Crown className="size-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" aria-label="Entfernen" onClick={() => confirm(`${m.name} aus dem Workspace entfernen?`) && remove.mutate(m.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ) : (
                  <Badge tone={m.role === 'owner' ? 'brand' : 'muted'}>{ROLES[m.role]}</Badge>
                )}
              </div>
            ))}
          </Card>

          {isAdmin && data.invites.length > 0 && (
            <Card>
              <CardHeader title="Offene Einladungen" subtitle="Link an die Person schicken – er ist einmal gültig." />
              <div className="divide-y divide-line">
                {data.invites.map((i) => (
                  <div key={i.id} className="flex items-center gap-3 px-5 py-3">
                    <Mail className="size-4 text-ink-3" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{i.email}</p>
                      <p className="text-xs text-ink-3">
                        {ROLES[i.role]} · {fmtDate(i.createdAt)}
                      </p>
                    </div>
                    <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => copy(i.token)}>
                      Link
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Zurückziehen" onClick={() => revoke.mutate(i.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card className="p-5">
            <p className="mb-3 text-[13px] font-semibold text-ink-2">Rollen</p>
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              {(Object.keys(ROLES) as Role[]).map((r) => (
                <div key={r} className="flex gap-2">
                  <dt className="w-28 shrink-0 font-medium">{ROLES[r]}</dt>
                  <dd className="text-ink-3">{ROLE_HINT[r]}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      )}
    </>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('inspector');
  const [link, setLink] = useState<string | null>(null);
  const toast = useToast();
  const invite = useAction(() => api<{ token: string }>('/account/members/invite', { body: { email, role } }), (r) => setLink(inviteLink(r.token)));
  return (
    <Modal
      title="Person einladen"
      onClose={onClose}
      footer={
        link ? (
          <Button onClick={onClose}>Fertig</Button>
        ) : (
          <>
            <Button variant="ghost" onClick={onClose}>
              Abbrechen
            </Button>
            <Button form="invite-form" loading={invite.isPending}>
              Einladung erstellen
            </Button>
          </>
        )
      }
    >
      {link ? (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-ink-2">Schicke diesen Link an {email}. Er kann einmal verwendet werden.</p>
          <div className="flex gap-2">
            <Input readOnly value={link} onFocus={(e) => e.target.select()} />
            <Button
              variant="secondary"
              icon={<Copy className="size-4" />}
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                toast('Kopiert');
              }}
            >
              Kopieren
            </Button>
          </div>
        </div>
      ) : (
        <form
          id="invite-form"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            invite.mutate(undefined);
          }}
        >
          {invite.error && <ErrorBox error={invite.error} />}
          <Field label="E-Mail">{(id) => <Input id={id} type="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Rolle" hint={ROLE_HINT[role]}>
            {(id) => (
              <Select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                {(['admin', 'inspector', 'viewer'] as Role[]).map((r) => (
                  <option key={r} value={r}>
                    {ROLES[r]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </form>
      )}
    </Modal>
  );
}

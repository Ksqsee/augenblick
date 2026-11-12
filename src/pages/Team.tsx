import clsx from 'clsx';
import { ChevronRight, Crown, KeyRound, Link2, Mail, ShieldAlert, ShieldCheck, Trash2, UserMinus, UserPlus, Users } from 'lucide-react';
import { useState } from 'react';
import { ROLES, type Role } from '../../shared/catalog';
import { api, type Member, queryClient, useAction, useBuildings, useFlagHistory, useMe, useMembers, useProperties } from '../api';
import { CopyField } from '../components/admin';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Empty,
  ErrorBox,
  Field,
  IconButton,
  Input,
  Menu,
  Modal,
  PageHeader,
  SectionHeader,
  Segmented,
  Select,
  SkeletonList,
  useConfirm,
  useToast,
} from '../components/ui';
import { fmtDate, fmtDateTime } from '../format';

const ROLE_HINT: Record<Role, string> = {
  owner: 'Alle Rechte, auch Workspace und Inhaberschaft',
  admin: 'Objekte, Team, Vorlagen und Einstellungen verwalten',
  inspector: 'Elemente anlegen und prüfen',
  viewer: 'Nur ansehen',
};
const EDITABLE_ROLES: Role[] = ['admin', 'inspector', 'viewer'];

const inviteLink = (token: string) => `${window.location.origin}/einladung/${token}`;

export function TeamPage() {
  const { data, isLoading, error, refetch } = useMembers();
  const { data: me } = useMe();
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const [inviting, setInviting] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [reset, setReset] = useState<{ name: string; url: string } | null>(null);
  const isAdmin = !!me && ['owner', 'admin'].includes(me.user.role);
  const isOwner = me?.user.role === 'owner';
  const remove = useAction((id: string) => api(`/account/members/${id}`, { method: 'DELETE' }), () => toast('Mitglied entfernt'));
  const revoke = useAction((id: string) => api(`/account/members/invite/${id}`, { method: 'DELETE' }), () => toast('Einladung zurückgezogen'));
  const resetLink = useAction(
    (m: { id: string; name: string }) => api<{ token: string }>(`/account/members/${m.id}/reset-link`, { method: 'POST' }),
    (r, m) => setReset({ name: m.name, url: `${window.location.origin}/passwort/${r.token}` }),
  );
  const transfer = useAction(
    (id: string) => api(`/account/members/${id}/transfer-ownership`, { method: 'POST' }),
    () => {
      queryClient.invalidateQueries({ queryKey: ['me'] });
      toast('Inhaberschaft übertragen');
    },
  );
  const copy = async (token: string) => {
    await navigator.clipboard.writeText(inviteLink(token)).catch(() => {});
    toast('Einladungslink kopiert');
  };
  const actionError = remove.error ?? revoke.error ?? resetLink.error ?? transfer.error;

  return (
    <>
      <PageHeader
        title="Team"
        subtitle="Wer im Workspace arbeitet und was er darf"
        actions={
          isAdmin && (
            <Button icon={<UserPlus />} onClick={() => setInviting(true)}>
              Einladen
            </Button>
          )
        }
      />
      {confirmEl}
      {inviting && <InviteModal onClose={() => setInviting(false)} />}
      {editing && <MemberDialog member={editing} canEditRole={isAdmin && editing.role !== 'owner' && editing.id !== me?.user.id} onClose={() => setEditing(null)} />}
      {reset && (
        <Modal title={`Passwort-Link für ${reset.name}`} description="24 Stunden und nur einmal gültig." onClose={() => setReset(null)} footer={<Button onClick={() => setReset(null)}>Fertig</Button>}>
          <div className="flex flex-col gap-3">
            <CopyField label="Passwort-Link" value={reset.url} />
            <p className="text-meta text-ink-3">Gib den Link persönlich weiter. Nach dem Zurücksetzen werden alle Sitzungen der Person beendet.</p>
          </div>
        </Modal>
      )}
      {actionError && <ErrorBox error={actionError} className="mb-4" />}

      {isLoading ? (
        <SkeletonList rows={5} />
      ) : error || !data ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : (
        <div className="flex flex-col gap-8 lg:gap-10">
          <section>
            <SectionHeader title="Mitglieder" count={data.members.length} meta={isAdmin ? 'Antippen zum Bearbeiten' : undefined} />
            <Card className="overflow-hidden">
              <ul className="divide-y divide-line" aria-label="Mitglieder">
                {data.members.map((m) => {
                  const self = m.id === me?.user.id;
                  const menu = isAdmin && m.role !== 'owner' && !self;
                  const info = (
                    <>
                      <Avatar name={m.name} size="md" />
                      <span className="min-w-0 flex-1">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-body font-medium text-ink">{m.name}</span>
                          {self && <span className="shrink-0 text-meta text-ink-3">du</span>}
                        </span>
                        <span className="mt-0.5 block truncate text-meta text-ink-3">
                          {m.email}
                          <span className="max-sm:hidden"> · seit {fmtDate(m.joinedAt)}</span>
                        </span>
                        <MemberBadges m={m} />
                      </span>
                      <span className="hidden w-28 shrink-0 text-meta text-ink-2 sm:block">{ROLES[m.role]}</span>
                    </>
                  );
                  return (
                    <li key={m.id} className="flex items-center">
                      {isAdmin ? (
                        <button
                          type="button"
                          aria-label={`Zugriff und Status von ${m.name}`}
                          onClick={() => setEditing(m)}
                          className="group flex min-h-16 min-w-0 flex-1 items-center gap-3 py-3 pl-4 text-left transition-colors hover:bg-hover sm:min-h-14"
                        >
                          {info}
                          <ChevronRight className="size-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5" />
                        </button>
                      ) : (
                        <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-4 py-3">{info}</div>
                      )}
                      {isAdmin && (
                        <div className="flex w-12 shrink-0 justify-center pr-1">
                          {menu && (
                          <Menu
                            label={`Weitere Aktionen für ${m.name}`}
                            items={[
                              ...(isOwner || m.role !== 'admin' ? [{ label: 'Passwort-Link erzeugen', icon: <KeyRound />, onClick: () => resetLink.mutate(m) }] : []),
                              ...(isOwner
                                ? [
                                    {
                                      label: 'Inhaberschaft übertragen',
                                      icon: <Crown />,
                                      onClick: async () => {
                                        if (await confirm({ title: `Inhaberschaft an ${m.name} übertragen?`, text: 'Du wirst danach Administrator/in.', confirmLabel: 'Übertragen' })) transfer.mutate(m.id);
                                      },
                                    },
                                  ]
                                : []),
                              'separator' as const,
                              {
                                label: 'Aus dem Workspace entfernen',
                                icon: <UserMinus />,
                                danger: true,
                                onClick: async () => {
                                  if (await confirm({ title: `${m.name} entfernen?`, text: 'Die Person verliert sofort den Zugriff. Protokolle bleiben erhalten.', confirmLabel: 'Entfernen', danger: true }))
                                    remove.mutate(m.id);
                                },
                              },
                            ]}
                          />
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Card>
          </section>

          {isAdmin && (
            <section>
              <SectionHeader title="Offene Einladungen" count={data.invites.length} meta="Einmal und 14 Tage gültig" />
              {!data.invites.length ? (
                <Card>
                  <Empty
                    compact
                    icon={<Mail />}
                    title="Keine offenen Einladungen"
                    text="Eingeladene Personen erscheinen hier, bis sie den Link genutzt haben."
                  />
                </Card>
              ) : (
                <Card className="overflow-hidden">
                  <ul className="divide-y divide-line">
                    {data.invites.map((i) => (
                      <li key={i.id} className="flex min-h-14 items-center gap-3 px-4 py-2.5">
                        <span className="grid size-8 shrink-0 place-items-center rounded-full border border-dashed border-line-strong text-ink-3">
                          <Mail className="size-4" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-body font-medium">{i.email}</p>
                          <p className="text-meta text-ink-3">
                            {ROLES[i.role]} · eingeladen {fmtDate(i.createdAt)}
                          </p>
                        </div>
                        <Button size="sm" variant="secondary" icon={<Link2 />} onClick={() => copy(i.token)}>
                          <span className="max-sm:sr-only">Link kopieren</span>
                        </Button>
                        <IconButton label={`Einladung an ${i.email} zurückziehen`} icon={<Trash2 />} onClick={() => revoke.mutate(i.id)} />
                      </li>
                    ))}
                  </ul>
                </Card>
              )}
            </section>
          )}

          <section>
            <SectionHeader title="Rollen" />
            <Card className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4">
              {(Object.keys(ROLES) as Role[]).map((r) => (
                <div key={r} className="flex flex-col gap-1 p-4 sm:[&:nth-child(n+3)]:border-t sm:[&:nth-child(n+3)]:border-line lg:[&:nth-child(n+2)]:border-l lg:[&:nth-child(n+3)]:border-t-0">
                  <p className="flex items-center gap-2 text-body font-medium">
                    {r === 'owner' ? <Crown className="size-4 text-ink-3" /> : <Users className="size-4 text-ink-3" />}
                    {ROLES[r]}
                  </p>
                  <p className="text-meta text-ink-3">{ROLE_HINT[r]}</p>
                </div>
              ))}
            </Card>
          </section>
        </div>
      )}
    </>
  );
}

/** Kurzinfo unter dem Namen: Bereich, Anlegerecht, Brandschutzbeauftragte/r. Rolle auf dem Handy. */
function MemberBadges({ m }: { m: Member }) {
  const limited = !!m.scope && (m.role === 'inspector' || m.role === 'viewer');
  const noCreate = m.role === 'inspector' && !m.canCreate;
  return (
    <span className="mt-1.5 flex flex-wrap gap-1.5 empty:hidden">
      <Badge variant="outline" className="sm:hidden">
        {ROLES[m.role]}
      </Badge>
      {limited && (
        <Badge tone="info" dot>
          {scopeText(m.scope!)}
        </Badge>
      )}
      {noCreate && <Badge tone="muted">Ohne Anlegerecht</Badge>}
      {m.fireOfficer && (
        <Badge variant="outline" className="max-w-full" icon={<ShieldCheck />}>
          <span className="truncate">Brandschutzbeauftragte/r{m.fireOfficerQualification ? ` · ${m.fireOfficerQualification}` : ''}</span>
        </Badge>
      )}
    </span>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const scopeText = (s: NonNullable<Member['scope']>) =>
  `Nur ${[s.propertyIds.length ? plural(s.propertyIds.length, 'Objekt', 'Objekte') : '', s.buildingIds.length ? plural(s.buildingIds.length, 'Gebäude', 'Gebäude') : ''].filter(Boolean).join(' + ')}`;

const toggled = (set: Set<string>, id: string, on: boolean) => {
  const next = new Set(set);
  if (on) next.add(id);
  else next.delete(id);
  return next;
};

/** Rolle, Zugriff, Anlegerecht und Status „Brandschutzbeauftragte/r“ eines Mitglieds (nur Admins). */
function MemberDialog({ member, canEditRole, onClose }: { member: Member; canEditRole: boolean; onClose: () => void }) {
  const toast = useToast();
  const [role, setRole] = useState<Role>(member.role);
  const scopable = role === 'inspector' || role === 'viewer';
  const props = useProperties();
  const builds = useBuildings(scopable);
  const history = useFlagHistory(member.id);
  const [mode, setMode] = useState<'all' | 'some'>(member.scope ? 'some' : 'all');
  const [propIds, setPropIds] = useState(() => new Set(member.scope?.propertyIds ?? []));
  const [buildIds, setBuildIds] = useState(() => new Set(member.scope?.buildingIds ?? []));
  const [canCreate, setCanCreate] = useState(member.canCreate);
  const [officer, setOfficer] = useState(member.fireOfficer);
  const [qualification, setQualification] = useState(member.fireOfficerQualification);
  const nothingPicked = scopable && mode === 'some' && !propIds.size && !buildIds.size;
  const save = useAction(
    async () => {
      if (role !== member.role) await api(`/account/members/${member.id}`, { method: 'PATCH', body: { role } });
      if (scopable) {
        // Gebäude eines ganz freigegebenen Objekts sind schon enthalten
        const parent = new Map((builds.data ?? []).map((b) => [b.id, b.propertyId]));
        const scope = mode === 'all' ? null : { propertyIds: [...propIds], buildingIds: [...buildIds].filter((b) => !propIds.has(parent.get(b) ?? '')) };
        await api(`/account/members/${member.id}/access`, { method: 'PUT', body: { scope, canCreate } });
      }
      const q = officer ? qualification.trim() : '';
      if (officer !== member.fireOfficer || q !== member.fireOfficerQualification) {
        await api(`/account/members/${member.id}/fire-officer`, { method: 'PUT', body: { value: officer, qualification: q } });
      }
    },
    () => {
      toast('Gespeichert');
      onClose();
    },
  );
  const check = 'size-4 shrink-0 rounded accent-ink';
  const sectionTitle = 'text-meta font-semibold text-ink-2';
  return (
    <Modal
      title={member.name}
      description={member.email}
      onClose={onClose}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Abbrechen
          </Button>
          <Button loading={save.isPending} disabled={nothingPicked} onClick={() => save.mutate(undefined)}>
            Speichern
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-6">
        {save.error && <ErrorBox error={save.error} />}
        <section className="flex flex-col gap-2">
          {canEditRole ? (
            <Field label="Rolle" hint={ROLE_HINT[role]}>
              {(id) => (
                <Select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)}>
                  {EDITABLE_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLES[r]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          ) : (
            <p className="text-body">
              <span className="font-medium">{ROLES[role]}</span> <span className="text-ink-3">· {ROLE_HINT[role]}</span>
            </p>
          )}
        </section>

        <section aria-labelledby="access-h" className="flex flex-col gap-3 border-t border-line pt-5">
          <h3 id="access-h" className={sectionTitle}>
            Zugriff
          </h3>
          {!scopable ? (
            <p className="text-body text-ink-3">{ROLES[role]} sehen und verwalten immer den gesamten Workspace.</p>
          ) : (
            <>
              <Segmented
                className="self-start"
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'all', label: 'Alle Objekte' },
                  { value: 'some', label: 'Ausgewählte Objekte' },
                ]}
              />
              {mode === 'some' && (
                <div className="overflow-hidden rounded-xl border border-line">
                  {props.isLoading || builds.isLoading ? (
                    <SkeletonList rows={3} className="shadow-none" />
                  ) : (
                    <ul className="scroll-thin max-h-72 divide-y divide-line overflow-y-auto" aria-label="Objekte und Gebäude">
                      {(props.data ?? []).map((p) => {
                        const whole = propIds.has(p.id);
                        const bs = (builds.data ?? []).filter((b) => b.propertyId === p.id);
                        return (
                          <li key={p.id} className="px-3.5 py-2.5">
                            <label className="flex min-h-7 cursor-pointer items-center gap-2.5 text-body font-medium">
                              <input type="checkbox" className={check} aria-label={p.name} checked={whole} onChange={(e) => setPropIds(toggled(propIds, p.id, e.target.checked))} />
                              <span className="min-w-0 truncate">{p.name}</span>
                              {whole && <span className="ml-auto shrink-0 text-caption font-normal text-ink-3">ganzes Objekt</span>}
                            </label>
                            {bs.length > 0 && (
                              <ul className="mt-1 ml-6 flex flex-col gap-0.5">
                                {bs.map((b) => (
                                  <li key={b.id}>
                                    <label className={clsx('flex min-h-7 cursor-pointer items-center gap-2.5 text-body', whole ? 'text-ink-3' : 'text-ink-2')}>
                                      <input
                                        type="checkbox"
                                        className={check}
                                        aria-label={`${p.name} – ${b.name}`}
                                        checked={whole || buildIds.has(b.id)}
                                        disabled={whole}
                                        onChange={(e) => setBuildIds(toggled(buildIds, b.id, e.target.checked))}
                                      />
                                      <span className="min-w-0 truncate">{b.name}</span>
                                    </label>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
              <p className="text-meta text-ink-3">
                {mode === 'all'
                  ? 'Sieht alle Objekte, Elemente, Prüfungen, Mängel und Aufgaben des Workspaces.'
                  : 'Andere Objekte sind für diese Person unsichtbar. Ein ganzes Objekt schließt später angelegte Gebäude ein; Begehungen des ganzen Objekts nur bei voller Freigabe.'}
              </p>
              {nothingPicked && <p className="text-meta text-bad">Wähle mindestens ein Objekt oder Gebäude.</p>}
              {role === 'inspector' && (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3.5 py-3">
                  <input type="checkbox" className={`mt-0.5 ${check}`} checked={canCreate} onChange={(e) => setCanCreate(e.target.checked)} />
                  <span>
                    <span className="block text-body font-medium">Darf neue Elemente anlegen</span>
                    <span className="block text-meta text-ink-3">Ohne dieses Recht nur vorhandene Elemente prüfen und bearbeiten.</span>
                  </span>
                </label>
              )}
            </>
          )}
        </section>

        <section aria-labelledby="officer-h" className="flex flex-col gap-3 border-t border-line pt-5">
          <h3 id="officer-h" className={sectionTitle}>
            Status
          </h3>
          <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line px-3.5 py-3">
            <input type="checkbox" className={`mt-0.5 ${check}`} checked={officer} onChange={(e) => setOfficer(e.target.checked)} />
            <span>
              <span className="block text-body font-medium">Brandschutzbeauftragte/r</span>
              <span className="block text-meta text-ink-3">Steht bei Begehungen im Protokoll und im Jahresbericht (DGUV Information 205-003).</span>
            </span>
          </label>
          {officer && (
            <Field label="Qualifikation" hint="z. B. Ausbildung nach DGUV 205-003, Lehrgang 2025">
              {(id) => <Input id={id} value={qualification} maxLength={300} onChange={(e) => setQualification(e.target.value)} />}
            </Field>
          )}
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-meta font-medium text-ink-2">Verlauf</p>
              {history.data &&
                (history.data.chainValid && history.data.currentMatches ? (
                  <Badge tone="ok" icon={<ShieldCheck />}>
                    Verlauf geprüft, unverändert
                  </Badge>
                ) : (
                  <Badge tone="bad" icon={<ShieldAlert />}>
                    {history.data.chainValid ? 'Status weicht vom Verlauf ab' : 'Verlauf wurde verändert'}
                  </Badge>
                ))}
            </div>
            {history.isLoading ? (
              <SkeletonList rows={1} className="shadow-none" />
            ) : history.error ? (
              <ErrorBox error={history.error} onRetry={() => history.refetch()} />
            ) : !history.data?.entries.length ? (
              <p className="text-meta text-ink-3">Noch keine Änderungen.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-line rounded-lg border border-line text-body" aria-label="Verlauf Brandschutzbeauftragte/r">
                {[...history.data.entries].reverse().map((e, i) => (
                  <li key={i} className="flex flex-col gap-0.5 px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
                    <span className="font-medium">{e.value ? 'Hinterlegt' : 'Entfernt'}</span>
                    {e.qualification && <span className="min-w-0 truncate text-ink-2">{e.qualification}</span>}
                    <span className="text-meta text-ink-3 tabular-nums sm:ml-auto sm:shrink-0">
                      {fmtDateTime(e.changedAt)} · {e.changedBy}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function InviteModal({ onClose }: { onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('inspector');
  const [link, setLink] = useState<string | null>(null);
  const invite = useAction(() => api<{ token: string }>('/account/members/invite', { body: { email, role } }), (r) => setLink(inviteLink(r.token)));
  return (
    <Modal
      title={link ? 'Einladung erstellt' : 'Person einladen'}
      description={link ? undefined : 'Du bekommst einen Link, den du selbst weitergibst.'}
      onClose={onClose}
      footer={
        link ? (
          <Button onClick={onClose}>Fertig</Button>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
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
          <p className="text-body text-ink-2">Schicke diesen Link an {email}. Er kann einmal verwendet werden.</p>
          <CopyField label="Einladungslink" value={link} />
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
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1.5 text-meta font-medium text-ink-2">Rolle</legend>
            {EDITABLE_ROLES.map((r) => (
              <label
                key={r}
                className={clsx(
                  'flex cursor-pointer items-start gap-3 rounded-lg border px-3.5 py-2.5 transition-colors',
                  role === r ? 'border-ink bg-canvas' : 'border-line hover:border-line-strong',
                )}
              >
                <input type="radio" name="role" className="mt-1 size-4 accent-ink" checked={role === r} onChange={() => setRole(r)} />
                <span>
                  <span className="block text-body font-medium">{ROLES[r]}</span>
                  <span className="block text-meta text-ink-3">{ROLE_HINT[r]}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </form>
      )}
    </Modal>
  );
}

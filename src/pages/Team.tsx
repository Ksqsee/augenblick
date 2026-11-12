import clsx from 'clsx';
import { ChevronRight, Crown, KeyRound, Link2, Trash2, UserMinus, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { ROLES, type Role } from '../../shared/catalog';
import { api, type Member, queryClient, useAction, useBuildings, useFlagHistory, useMe, useMembers, useProperties } from '../api';
import { CopyField } from '../components/admin';
import {
  Avatar,
  Button,
  ErrorBox,
  Field,
  IconButton,
  Input,
  Menu,
  Modal,
  PageHeader,
  Section,
  Segmented,
  Select,
  SkeletonList,
  StatusText,
  Surface,
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
        <Surface>
          <Section title="Mitglieder" count={data.members.length} flush>
            <ul className="pk-list" aria-label="Mitglieder">
              {data.members.map((m) => {
                const self = m.id === me?.user.id;
                const menu = isAdmin && m.role !== 'owner' && !self;
                const info = (
                  <>
                    <Avatar name={m.name} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="truncate text-body text-ink">{m.name}</span>
                        {self && <span className="shrink-0 text-meta text-ink-3">du</span>}
                      </span>
                      <span className="mt-0.5 block truncate text-meta text-ink-3">{memberMeta(m)}</span>
                    </span>
                    <span className="hidden w-32 shrink-0 text-meta text-ink-2 sm:block">{ROLES[m.role]}</span>
                  </>
                );
                return (
                  <li key={m.id} className="flex items-center" style={{ '--row-inset': '44px' } as React.CSSProperties}>
                    {isAdmin ? (
                      <button
                        type="button"
                        aria-label={`Zugriff und Status von ${m.name}`}
                        onClick={() => setEditing(m)}
                        className="group flex min-h-[60px] min-w-0 flex-1 items-center gap-3 py-2.5 pl-(--row-px) text-left transition-colors hover:bg-hover sm:min-h-14"
                      >
                        {info}
                        <ChevronRight className="size-4 shrink-0 text-ink-4 transition-transform group-hover:translate-x-0.5" />
                      </button>
                    ) : (
                      <div className="flex min-h-14 min-w-0 flex-1 items-center gap-3 px-(--row-px) py-2.5">{info}</div>
                    )}
                    {isAdmin && (
                      <div className="flex w-12 shrink-0 justify-center pr-1 sm:mr-[calc(var(--row-px)-1rem)]">
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
          </Section>

          {isAdmin && (
            <Section title="Offene Einladungen" count={data.invites.length} action={<span className="text-meta text-ink-3">Einmal und 14 Tage gültig</span>} flush={data.invites.length > 0}>
              {!data.invites.length ? (
                <p className="text-body text-ink-2">Keine offenen Einladungen. Eingeladene Personen erscheinen hier, bis sie den Link genutzt haben.</p>
              ) : (
                <ul className="pk-list" aria-label="Offene Einladungen">
                  {data.invites.map((i) => (
                    <li key={i.id} className="flex min-h-14 items-center gap-2 py-2 pr-[calc(var(--row-px)-0.5rem)] pl-(--row-px)">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-body">{i.email}</p>
                        <p className="text-meta text-ink-3">
                          {ROLES[i.role]} · eingeladen {fmtDate(i.createdAt)}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" icon={<Link2 />} onClick={() => copy(i.token)}>
                        <span className="max-sm:sr-only">Link kopieren</span>
                      </Button>
                      <IconButton label={`Einladung an ${i.email} zurückziehen`} icon={<Trash2 />} onClick={() => revoke.mutate(i.id)} />
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          )}

          <Section title="Rollen">
            <dl className="grid grid-cols-1 gap-x-10 gap-y-3 sm:grid-cols-2">
              {(Object.keys(ROLES) as Role[]).map((r) => (
                <div key={r} className="min-w-0">
                  <dt className="text-body text-ink">{ROLES[r]}</dt>
                  <dd className="text-meta text-ink-3">{ROLE_HINT[r]}</dd>
                </div>
              ))}
            </dl>
          </Section>
        </Surface>
      )}
    </>
  );
}

/** Meta-Zeile unter dem Namen: E-Mail, Rolle (Handy), Bereich, Anlegerecht, Brandschutzbeauftragte/r – als Text. */
function memberMeta(m: Member) {
  const limited = !!m.scope && (m.role === 'inspector' || m.role === 'viewer');
  const parts = [
    m.email,
    limited ? scopeText(m.scope!) : '',
    m.role === 'inspector' && !m.canCreate ? 'Ohne Anlegerecht' : '',
    m.fireOfficer ? `Brandschutzbeauftragte/r${m.fireOfficerQualification ? ` (${m.fireOfficerQualification})` : ''}` : '',
  ].filter(Boolean);
  return (
    <>
      <span className="sm:hidden">{ROLES[m.role]} · </span>
      {parts.join(' · ')}
    </>
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
  const sectionTitle = 'text-meta font-medium text-ink-3';
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
              {ROLES[role]} <span className="text-ink-3">· {ROLE_HINT[role]}</span>
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
                <div className="overflow-hidden rounded-md border border-line">
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
              {nothingPicked && <p className="text-meta text-ink-2">Wähle mindestens ein Objekt oder Gebäude.</p>}
              {role === 'inspector' && (
                <label className="flex cursor-pointer items-start gap-2.5 py-1">
                  <input type="checkbox" className={`mt-0.5 ${check}`} checked={canCreate} onChange={(e) => setCanCreate(e.target.checked)} />
                  <span>
                    <span className="block text-body">Darf neue Elemente anlegen</span>
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
          <label className="flex cursor-pointer items-start gap-2.5 py-1">
            <input type="checkbox" className={`mt-0.5 ${check}`} checked={officer} onChange={(e) => setOfficer(e.target.checked)} />
            <span>
              <span className="block text-body">Brandschutzbeauftragte/r</span>
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
                  <StatusText tone="ok">Verlauf geprüft, unverändert</StatusText>
                ) : (
                  <StatusText tone="bad">{history.data.chainValid ? 'Status weicht vom Verlauf ab' : 'Verlauf wurde verändert'}</StatusText>
                ))}
            </div>
            {history.isLoading ? (
              <SkeletonList rows={1} className="shadow-none" />
            ) : history.error ? (
              <ErrorBox error={history.error} onRetry={() => history.refetch()} />
            ) : !history.data?.entries.length ? (
              <p className="text-meta text-ink-3">Noch keine Änderungen.</p>
            ) : (
              <ol className="flex flex-col divide-y divide-line border-y border-line text-body" aria-label="Verlauf Brandschutzbeauftragte/r">
                {[...history.data.entries].reverse().map((e, i) => (
                  <li key={i} className="flex flex-col gap-0.5 py-2 sm:flex-row sm:items-center sm:gap-3">
                    <span>{e.value ? 'Hinterlegt' : 'Entfernt'}</span>
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
                  'flex cursor-pointer items-start gap-3 rounded-md border px-3.5 py-2.5 transition-colors',
                  role === r ? 'border-line-strong bg-selected' : 'border-line hover:border-line-strong',
                )}
              >
                <input type="radio" name="role" className="mt-1 size-4 accent-ink" checked={role === r} onChange={() => setRole(r)} />
                <span>
                  <span className="block text-body">{ROLES[r]}</span>
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

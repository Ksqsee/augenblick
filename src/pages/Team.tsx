import { Copy, Crown, KeyRound, Mail, ShieldAlert, ShieldCheck, SlidersHorizontal, Trash2, UserPlus } from 'lucide-react';
import { useState } from 'react';
import { ROLES, type Role } from '../../shared/catalog';
import { api, type Member, queryClient, useAction, useBuildings, useFlagHistory, useMe, useMembers, useProperties } from '../api';
import { Badge, Button, Card, CardHeader, ErrorBox, Field, Input, Modal, PageHeader, Segmented, Select, Spinner, useToast } from '../components/ui';
import { fmtDate, fmtDateTime } from '../format';

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
  const [editing, setEditing] = useState<Member | null>(null);
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
      {editing && <MemberDialog member={editing} onClose={() => setEditing(null)} />}
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
                    <MemberBadges m={m} />
                  </div>
                </div>
                {isAdmin && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="self-start sm:self-auto"
                    icon={<SlidersHorizontal className="size-4" />}
                    aria-label={`Zugriff und Status von ${m.name}`}
                    onClick={() => setEditing(m)}
                  >
                    Zugriff
                  </Button>
                )}
                {isAdmin && m.role !== 'owner' && m.id !== me?.user.id ? (
                  <div className="flex flex-wrap gap-2">
                    <Select value={m.role} onChange={(e) => setRole.mutate({ id: m.id, role: e.target.value as Role })} className="h-9 w-44">
                      {(['admin', 'inspector', 'viewer'] as Role[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLES[r]}
                        </option>
                      ))}
                    </Select>
                    {(me?.user.role === 'owner' || m.role !== 'admin') && (
                      <Button variant="ghost" size="sm" aria-label={`Passwort-Link für ${m.name}`} title="Link zum Zurücksetzen des Passworts" onClick={() => resetLink.mutate(m)}>
                        <KeyRound className="size-4" />
                      </Button>
                    )}
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
              <CardHeader title="Offene Einladungen" subtitle="Link an die Person schicken – er ist einmal und 14 Tage lang gültig." />
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
            <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
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

/** Kurzinfo unter dem Namen: Bereich, Anlegerecht, Brandschutzbeauftragte/r. */
function MemberBadges({ m }: { m: Member }) {
  const limited = !!m.scope && (m.role === 'inspector' || m.role === 'viewer');
  const noCreate = m.role === 'inspector' && !m.canCreate;
  if (!limited && !noCreate && !m.fireOfficer) return null;
  return (
    <div className="mt-1.5 flex flex-wrap gap-1.5">
      {limited && <Badge tone="info">{scopeText(m.scope!)}</Badge>}
      {noCreate && <Badge tone="muted">Ohne Anlegerecht</Badge>}
      {m.fireOfficer && (
        <Badge tone="brand" className="max-w-full">
          <span className="truncate">Brandschutzbeauftragte/r{m.fireOfficerQualification ? ` · ${m.fireOfficerQualification}` : ''}</span>
        </Badge>
      )}
    </div>
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

/** Zugriff, Anlegerecht und Status „Brandschutzbeauftragte/r“ eines Mitglieds (nur Admins). */
function MemberDialog({ member, onClose }: { member: Member; onClose: () => void }) {
  const toast = useToast();
  const scopable = member.role === 'inspector' || member.role === 'viewer';
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
  const check = 'size-4 shrink-0 accent-[var(--color-brand)]';
  return (
    <Modal
      title={member.name}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
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
        <section aria-labelledby="access-h" className="flex flex-col gap-3">
          <h3 id="access-h" className="text-sm font-semibold">
            Zugriff
          </h3>
          {!scopable ? (
            <p className="text-sm text-ink-3">{ROLES[member.role]} sehen und verwalten immer den gesamten Workspace.</p>
          ) : (
            <>
              <Segmented
                value={mode}
                onChange={setMode}
                options={[
                  { value: 'all', label: 'Alle Objekte' },
                  { value: 'some', label: 'Ausgewählte Objekte' },
                ]}
              />
              {mode === 'some' && (
                <div className="rounded-xl border border-line">
                  {props.isLoading || builds.isLoading ? (
                    <Spinner />
                  ) : (
                    <ul className="max-h-72 divide-y divide-line overflow-y-auto" aria-label="Objekte und Gebäude">
                      {(props.data ?? []).map((p) => {
                        const whole = propIds.has(p.id);
                        const bs = (builds.data ?? []).filter((b) => b.propertyId === p.id);
                        return (
                          <li key={p.id} className="px-3.5 py-2.5">
                            <label className="flex items-center gap-2.5 text-sm font-medium">
                              <input type="checkbox" className={check} aria-label={p.name} checked={whole} onChange={(e) => setPropIds(toggled(propIds, p.id, e.target.checked))} />
                              <span className="min-w-0 truncate">{p.name}</span>
                              {whole && <span className="ml-auto shrink-0 text-xs font-normal text-ink-3">ganzes Objekt</span>}
                            </label>
                            {bs.length > 0 && (
                              <ul className="mt-1.5 ml-6 flex flex-col gap-1.5">
                                {bs.map((b) => (
                                  <li key={b.id}>
                                    <label className={`flex items-center gap-2.5 text-sm ${whole ? 'text-ink-3' : 'text-ink-2'}`}>
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
              <p className="text-xs text-ink-3">
                {mode === 'all'
                  ? 'Sieht alle Objekte, Elemente, Prüfungen, Mängel und Aufgaben des Workspaces.'
                  : 'Andere Objekte sind für diese Person unsichtbar. Ein ganzes Objekt schließt später angelegte Gebäude ein; Begehungen des ganzen Objekts nur bei voller Freigabe.'}
              </p>
              {nothingPicked && <p className="text-xs text-bad">Bitte mindestens ein Objekt oder Gebäude auswählen.</p>}
              {member.role === 'inspector' && (
                <label className="flex items-start gap-2.5 text-sm">
                  <input type="checkbox" className={`mt-0.5 ${check}`} checked={canCreate} onChange={(e) => setCanCreate(e.target.checked)} />
                  <span>
                    Darf neue Elemente anlegen
                    <span className="block text-xs text-ink-3">Ohne dieses Recht nur vorhandene Elemente prüfen und bearbeiten.</span>
                  </span>
                </label>
              )}
            </>
          )}
        </section>

        <section aria-labelledby="officer-h" className="flex flex-col gap-3 border-t border-line pt-5">
          <h3 id="officer-h" className="text-sm font-semibold">
            Brandschutzbeauftragte/r
          </h3>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className={`mt-0.5 ${check}`} checked={officer} onChange={(e) => setOfficer(e.target.checked)} />
            <span>
              Brandschutzbeauftragte/r
              <span className="block text-xs text-ink-3">Wird bei Begehungen im Protokoll und im Jahresbericht vermerkt (DGUV Information 205-003).</span>
            </span>
          </label>
          {officer && (
            <Field label="Qualifikation" hint="z. B. Ausbildung nach DGUV 205-003, Lehrgang 2025">
              {(id) => <Input id={id} value={qualification} maxLength={300} onChange={(e) => setQualification(e.target.value)} />}
            </Field>
          )}
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-[13px] font-medium text-ink-2">Verlauf</p>
              {history.data &&
                (history.data.chainValid && history.data.currentMatches ? (
                  <Badge tone="ok">
                    <ShieldCheck className="size-3.5" /> Verlauf geprüft, unverändert
                  </Badge>
                ) : (
                  <Badge tone="bad">
                    <ShieldAlert className="size-3.5" /> {history.data.chainValid ? 'Status weicht vom Verlauf ab' : 'Verlauf wurde verändert'}
                  </Badge>
                ))}
            </div>
            {history.isLoading ? (
              <Spinner />
            ) : history.error ? (
              <ErrorBox error={history.error} />
            ) : !history.data?.entries.length ? (
              <p className="text-sm text-ink-3">Noch keine Änderungen.</p>
            ) : (
              <ol className="flex flex-col gap-1.5 text-sm" aria-label="Verlauf Brandschutzbeauftragte/r">
                {[...history.data.entries].reverse().map((e, i) => (
                  <li key={i} className="flex flex-col rounded-lg bg-sunken px-3 py-2 sm:flex-row sm:items-center sm:gap-3">
                    <span className="font-medium">{e.value ? 'Hinterlegt' : 'Entfernt'}</span>
                    {e.qualification && <span className="min-w-0 truncate text-ink-2">{e.qualification}</span>}
                    <span className="text-xs text-ink-3 sm:ml-auto sm:shrink-0">
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

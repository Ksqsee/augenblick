// Befähigungsnachweise (Plan v7, Paket X): Liste je Mitglied mit Art, Aussteller, Nummer, gültig bis und Elementarten.
// Pflege im eigenen Konto (Einstellungen → Konto) und für Admins im Team (Mitglied öffnen). Das Prüfprotokoll druckt
// je Elementart den passenden gültigen Nachweis; fehlt er, weist CredentialHint beim Abschließen darauf hin.
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { type Credential, CREDENTIAL_KINDS, type CredentialKind, credentialText, endOfDayUtc, isValidAt, pickCredential } from '../../shared/credentials';
import { api, useAction, useMe } from '../api';
import { allCategories } from '../categories';
import { categoryLabel } from '../format';
import { Button, ErrorBox, Field, IconButton, Input, Notice, Select, SkeletonList, StatusText, useConfirm, useToast } from './ui';

export const useCredentials = (userId?: string, enabled = true) =>
  useQuery({
    queryKey: ['credentials', userId ?? 'all'],
    queryFn: () => api<Credential[]>(`/credentials${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),
    enabled,
    staleTime: 60_000,
  });

const SOON = 60 * 86_400_000;
/** „gültig bis“ ist das Ende des Kalendertages in UTC – in UTC anzeigen, sonst springt es in den Folgetag. */
const fmtDate = (t: number) => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' }).format(t);
const ymdOf = (t: number | null) => (t == null ? '' : new Date(t).toISOString().slice(0, 10));

function validity(c: Credential) {
  if (c.validUntil == null) return <span className="text-ink-3">unbefristet</span>;
  const now = Date.now();
  if (!isValidAt(c, now)) return <StatusText tone="bad">abgelaufen am {fmtDate(c.validUntil)}</StatusText>;
  if (c.validUntil - now < SOON) return <StatusText tone="warn">gültig bis {fmtDate(c.validUntil)}</StatusText>;
  return <span className="text-ink-3">gültig bis {fmtDate(c.validUntil)}</span>;
}

/** Nachweise einer Person; mit `editable` hinzufügen, ändern, entfernen. */
export function CredentialList({ userId, editable, emptyText }: { userId: string; editable: boolean; emptyText?: string }) {
  const { data, isLoading, error, refetch } = useCredentials(userId);
  const [editing, setEditing] = useState<Credential | 'new' | null>(null);
  const [confirm, confirmEl] = useConfirm();
  const toast = useToast();
  const del = useAction((id: string) => api(`/credentials/${id}`, { method: 'DELETE' }), () => toast('Nachweis entfernt'));
  const list = data ?? [];
  return (
    <div className="flex flex-col gap-3" data-credentials={userId}>
      {confirmEl}
      {del.error && <ErrorBox error={del.error} />}
      {isLoading ? (
        <SkeletonList rows={2} className="shadow-none" />
      ) : error ? (
        <ErrorBox error={error} onRetry={() => refetch()} />
      ) : !list.length && editing !== 'new' ? (
        <p className="text-body text-ink-2">{emptyText ?? 'Noch kein Nachweis hinterlegt.'}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-line border-y border-line" aria-label="Nachweise">
          {list.map((c) =>
            editing !== 'new' && editing?.id === c.id ? (
              <li key={c.id} className="py-3">
                <CredentialForm userId={userId} initial={c} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <li key={c.id} className="flex items-start gap-2 py-2.5" data-credential={c.id}>
                <div className="min-w-0 flex-1">
                  <p className="text-body break-words text-ink">{credentialText(c)}</p>
                  <p className="mt-0.5 text-meta text-ink-3">
                    {CREDENTIAL_KINDS[c.kind]} · {validity(c)} · {c.categories.length ? c.categories.map((k) => categoryLabel(k)).join(', ') : 'alle Elementarten'}
                  </p>
                </div>
                {editable && (
                  <>
                    <IconButton label={`${credentialText(c)} ändern`} icon={<Pencil />} size="sm" onClick={() => setEditing(c)} />
                    <IconButton
                      label={`${credentialText(c)} entfernen`}
                      icon={<Trash2 />}
                      size="sm"
                      onClick={async () => {
                        if (await confirm({ title: 'Nachweis entfernen?', text: 'Bereits erzeugte PDFs bleiben unverändert; neue Protokolle zeigen ihn nicht mehr.', confirmLabel: 'Entfernen', danger: true }))
                          del.mutate(c.id);
                      }}
                    />
                  </>
                )}
              </li>
            ),
          )}
        </ul>
      )}
      {editable &&
        (editing === 'new' ? (
          <CredentialForm userId={userId} onDone={() => setEditing(null)} />
        ) : (
          <Button variant="secondary" size="sm" icon={<Plus />} className="self-start" onClick={() => setEditing('new')}>
            Nachweis hinzufügen
          </Button>
        ))}
    </div>
  );
}

function CredentialForm({ userId, initial, onDone }: { userId: string; initial?: Credential; onDone: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<CredentialKind>(initial?.kind ?? 'expertise');
  const [title, setTitle] = useState(initial?.title ?? '');
  const [issuer, setIssuer] = useState(initial?.issuer ?? '');
  const [number, setNumber] = useState(initial?.number ?? '');
  const [until, setUntil] = useState(ymdOf(initial?.validUntil ?? null));
  const [cats, setCats] = useState<Set<string>>(new Set(initial?.categories ?? []));
  const save = useAction(
    () => {
      const body = { userId, kind, title, issuer, number, validUntil: until ? endOfDayUtc(until) : null, categories: [...cats] };
      return initial ? api(`/credentials/${initial.id}`, { method: 'PUT', body }) : api('/credentials', { body });
    },
    () => {
      toast(initial ? 'Nachweis gespeichert' : 'Nachweis hinzugefügt');
      onDone();
    },
  );
  const check = 'size-4 shrink-0 rounded accent-ink';
  return (
    <form
      className="flex flex-col gap-3 rounded-md border border-line p-3.5"
      aria-label={initial ? 'Nachweis ändern' : 'Neuer Nachweis'}
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(undefined);
      }}
    >
      {save.error && <ErrorBox error={save.error} />}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Art">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as CredentialKind)}>
              {(Object.keys(CREDENTIAL_KINDS) as CredentialKind[]).map((k) => (
                <option key={k} value={k}>
                  {CREDENTIAL_KINDS[k]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Gültig bis" optional hint="leer = unbefristet">
          {(id) => <Input id={id} type="date" value={until} onChange={(e) => setUntil(e.target.value)} />}
        </Field>
        <Field label="Bezeichnung" optional className="sm:col-span-2">
          {(id) => <Input id={id} value={title} maxLength={200} placeholder="z. B. Befähigte Person für Brandschutztüren" onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <Field label="Aussteller" optional>
          {(id) => <Input id={id} value={issuer} maxLength={120} placeholder="z. B. Hersteller oder Schulungsträger" onChange={(e) => setIssuer(e.target.value)} />}
        </Field>
        <Field label="Nummer" optional>
          {(id) => <Input id={id} value={number} maxLength={80} onChange={(e) => setNumber(e.target.value)} />}
        </Field>
      </div>
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-meta font-medium text-ink">Gilt für</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {allCategories().map((c) => (
            <label key={c.key} className="flex min-h-8 cursor-pointer items-center gap-2 text-body">
              <input
                type="checkbox"
                className={check}
                checked={cats.has(c.key)}
                onChange={(e) => {
                  const next = new Set(cats);
                  if (e.target.checked) next.add(c.key);
                  else next.delete(c.key);
                  setCats(next);
                }}
              />
              {c.label}
            </label>
          ))}
        </div>
        <p className="text-caption text-ink-3">Nichts gewählt = gilt für alle Elementarten.</p>
      </fieldset>
      <div className="flex flex-wrap justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Abbrechen
        </Button>
        <Button size="sm" loading={save.isPending}>
          {initial ? 'Speichern' : 'Hinzufügen'}
        </Button>
      </div>
    </form>
  );
}

/**
 * Hinweis beim Abschließen (kein Blocker): Hat die prüfende Person für diese Elementart(en) keinen gültigen Nachweis,
 * steht das im Protokoll und auf dem Deckblatt der Sammelmappe. Einhängen im Prüfablauf (`run.tsx`) vor der
 * Unterschrift: `<CredentialHint categories={[subject.category]} manufacturer={subject.manufacturer} />`.
 */
export function CredentialHint({ categories, manufacturer, inspectorId, className }: { categories: string[]; manufacturer?: string | null; inspectorId?: string; className?: string }) {
  const { data: me } = useMe();
  const uid = inspectorId ?? me?.user.id;
  const { data } = useCredentials(uid, !!uid && me?.user.role !== 'viewer');
  if (!data || !uid) return null;
  const gaps = missingProof(data, categories, { manufacturer });
  if (!gaps.length) return null;
  const self = uid === me?.user.id;
  return (
    <Notice tone="warn" title="Befähigungsnachweis fehlt" className={clsx(className)}>
      <span data-credential-hint>
        {gaps.map((g) => `${categoryLabel(g.category)}: ${g.status === 'expired' ? 'abgelaufen' : 'nicht hinterlegt'}`).join(' · ')}. Du kannst trotzdem abschließen; das Protokoll weist darauf hin.
      </span>
      {self && (
        <Link to="/einstellungen?tab=profile#nachweise" className="mt-1 block text-meta text-ink-2 underline decoration-ink-4 underline-offset-4 hover:text-ink">
          Nachweis hinterlegen
        </Link>
      )}
    </Notice>
  );
}

/** Elementarten ohne gültigen Nachweis (heute). */
export function missingProof(list: Credential[], categories: string[], opts: { manufacturer?: string | null; at?: number } = {}) {
  return [...new Set(categories)]
    .map((category) => ({ category, ...pickCredential(list, { category, manufacturer: opts.manufacturer, at: opts.at ?? Date.now() }) }))
    .filter((p) => p.status !== 'ok');
}

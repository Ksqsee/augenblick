// Einstellungen → API: Zugangsschlüssel, Verbindung mit Claude (MCP) in zwei Schritten, REST-Kurzreferenz.
import { useQuery } from '@tanstack/react-query';
import { KeyRound, Plus } from 'lucide-react';
import { useState } from 'react';
import { api, queryClient, useAction } from '../../api';
import { CodeBlock, CopyField, Steps } from '../../components/admin';
import { Badge, Button, Empty, ErrorBox, Field, Input, Menu, Modal, Notice, RowIcon, Select, SettingsSection, SkeletonList, useConfirm, useToast } from '../../components/ui';
import { fmtDate, fmtRelative } from '../../format';

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scope: 'read' | 'write';
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdBy: string;
}

/** Werkzeuge des MCP-Servers (Anzeige). Neue Werkzeuge nur hier ergänzen. */
export const MCP_TOOLS = [
  'dashboard',
  'search',
  'list_properties',
  'get_property',
  'list_assets',
  'get_asset',
  'list_inspections',
  'get_inspection',
  'list_defects',
  'get_defect',
  'resolve_defect',
  'report_defect',
  'list_action_required',
  'list_tasks',
  'create_task',
  'update_task_status',
  'bulk_update_tasks',
  'add_task_comment',
  'list_categories',
  'create_asset',
  'list_walkthroughs',
  'plan_rounds',
  'get_suggestions',
  'create_tasks_from_defects',
  'list_automations',
  'set_automation',
  'list_automation_log',
  'structure_dictation',
];

/** Kurzreferenz der REST-Endpunkte: [Methode + Pfad, Beschreibung]. */
const ENDPOINTS: [string, string][] = [
  ['GET /api/properties', 'Objekte; /:id mit Gebäuden und Elementen'],
  ['GET /api/assets', 'Elemente; Filter due=overdue|soon|never, schedule, propertyId, q'],
  ['GET /api/inspections', 'Prüfungen; ?status=submitted, /:id mit Protokolldaten'],
  ['GET /api/defects', 'Mängel; ?status=open'],
  ['GET /api/tasks', 'Aufgaben'],
  ['GET /api/export/assets.xlsx', 'Elementliste als Excel (auch .csv)'],
  ['POST /api/assets, /api/tasks', 'Anlegen – nur mit Schreibrechten'],
];

export function ApiTab() {
  return (
    <div>
      <KeysSection />
      <McpSection />
      <RestSection />
    </div>
  );
}

function KeysSection() {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const q = useQuery({ queryKey: ['api-keys'], queryFn: () => api<ApiKeyRow[]>('/account/api-keys') });
  const [form, setForm] = useState<{ name: string; scope: 'read' | 'write'; expiresInDays: number | '' } | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const create = useAction(
    () => api<{ key: string }>('/account/api-keys', { body: { name: form!.name, scope: form!.scope, expiresInDays: form!.expiresInDays === '' ? null : form!.expiresInDays } }),
    (r) => {
      setForm(null);
      setCreated(r.key);
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
    },
  );
  const revoke = useAction(
    (id: string) => api(`/account/api-keys/${id}`, { method: 'DELETE' }),
    () => {
      queryClient.invalidateQueries({ queryKey: ['api-keys'] });
      toast('Schlüssel widerrufen');
    },
  );
  const keys = q.data ?? [];
  const active = keys.filter((k) => !k.revokedAt && !(k.expiresAt && k.expiresAt < Date.now()));
  const inactive = keys.filter((k) => !active.includes(k));
  const [showOld, setShowOld] = useState(false);
  const newKey = () => setForm({ name: '', scope: 'read', expiresInDays: 365 });

  return (
    <section className="grid gap-4 border-b border-line py-8 pt-0 lg:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] lg:gap-10">
      {confirmEl}
      <div>
        <h2 className="text-title font-semibold">API-Schlüssel</h2>
        <p className="mt-1 text-meta text-ink-3">Für Fremdsysteme wie CAFM, ERP oder BI und für Verbindungen mit Claude. Ein Schlüssel handelt im Namen der Person, die ihn erstellt – höchstens mit Prüfer-Rechten.</p>
      </div>
      <div className="min-w-0">
        {revoke.error && <ErrorBox error={revoke.error} className="mb-3" />}
        {q.isLoading ? (
          <SkeletonList rows={2} />
        ) : q.error ? (
          <ErrorBox error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <div className="overflow-hidden rounded-xl bg-surface shadow-card">
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
              <span className="text-meta text-ink-3 tabular-nums">
                {active.length} {active.length === 1 ? 'aktiver Schlüssel' : 'aktive Schlüssel'}
              </span>
              <Button size="sm" icon={<Plus />} onClick={newKey}>
                Neuer Schlüssel
              </Button>
            </div>
            {!keys.length ? (
              <Empty compact icon={<KeyRound />} title="Noch keine Schlüssel" text="Lege einen Schlüssel an, um Prüfkompass mit anderen Systemen zu verbinden." />
            ) : (
              <ul className="divide-y divide-line">
                {[...active, ...(showOld ? inactive : [])].map((k) => {
                  const expired = !!k.expiresAt && k.expiresAt < Date.now();
                  const off = !!k.revokedAt || expired;
                  return (
                    <li key={k.id} className="flex items-center gap-3 px-4 py-3">
                      <RowIcon className={off ? 'opacity-50' : undefined}>
                        <KeyRound />
                      </RowIcon>
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body font-medium">
                          <span className={off ? 'text-ink-3 line-through decoration-ink-4' : undefined}>{k.name}</span>
                          <span className="font-mono text-caption font-normal text-ink-3">{k.prefix}…</span>
                          {k.revokedAt ? (
                            <Badge tone="muted">Widerrufen</Badge>
                          ) : expired ? (
                            <Badge tone="muted">Abgelaufen</Badge>
                          ) : (
                            <Badge variant="outline" tone={k.scope === 'write' ? 'warn' : 'muted'}>
                              {k.scope === 'write' ? 'Lesen + Schreiben' : 'Nur lesen'}
                            </Badge>
                          )}
                        </p>
                        <p className="mt-0.5 truncate text-meta text-ink-3">
                          {k.lastUsedAt ? `Zuletzt genutzt ${fmtRelative(k.lastUsedAt)}` : 'Noch nicht genutzt'} · {k.createdBy} · {k.expiresAt ? `gültig bis ${fmtDate(k.expiresAt)}` : 'ohne Ablauf'}
                        </p>
                      </div>
                      {!k.revokedAt && (
                        <Menu
                          label={`Aktionen für ${k.name}`}
                          items={[
                            {
                              label: 'Widerrufen',
                              danger: true,
                              onClick: async () => {
                                if (
                                  await confirm({
                                    title: `„${k.name}“ widerrufen?`,
                                    text: 'Systeme und Verbindungen, die diesen Schlüssel nutzen, verlieren sofort den Zugriff.',
                                    confirmLabel: 'Widerrufen',
                                    danger: true,
                                  })
                                )
                                  revoke.mutate(k.id);
                              },
                            },
                          ]}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {inactive.length > 0 && (
              <button type="button" onClick={() => setShowOld(!showOld)} className="w-full border-t border-line px-4 py-2.5 text-left text-meta font-medium text-ink-2 hover:bg-hover hover:text-ink">
                {showOld ? 'Widerrufene und abgelaufene ausblenden' : `${inactive.length} widerrufene oder abgelaufene anzeigen`}
              </button>
            )}
          </div>
        )}
      </div>

      {form && (
        <Modal
          title="Neuer API-Schlüssel"
          onClose={() => setForm(null)}
          footer={
            <>
              <Button variant="secondary" onClick={() => setForm(null)}>
                Abbrechen
              </Button>
              <Button form="api-key-form" loading={create.isPending}>
                Erstellen
              </Button>
            </>
          }
        >
          <form
            id="api-key-form"
            className="flex flex-col gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(undefined);
            }}
          >
            {create.error && <ErrorBox error={create.error} />}
            <Field label="Name" hint="Wofür ist der Schlüssel? z. B. „CAFM Hausverwaltung“">
              {(id) => <Input id={id} required minLength={2} autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />}
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Rechte">
                {(id) => (
                  <Select id={id} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as 'read' | 'write' })}>
                    <option value="read">Nur lesen</option>
                    <option value="write">Lesen und schreiben</option>
                  </Select>
                )}
              </Field>
              <Field label="Gültigkeit">
                {(id) => (
                  <Select id={id} value={form.expiresInDays} onChange={(e) => setForm({ ...form, expiresInDays: e.target.value === '' ? '' : Number(e.target.value) })}>
                    <option value={30}>30 Tage</option>
                    <option value={90}>90 Tage</option>
                    <option value={365}>1 Jahr</option>
                    <option value="">Unbegrenzt</option>
                  </Select>
                )}
              </Field>
            </div>
          </form>
        </Modal>
      )}
      {created && (
        <Modal title="Schlüssel erstellt" description="Nur jetzt sichtbar – danach nicht mehr abrufbar." onClose={() => setCreated(null)} footer={<Button onClick={() => setCreated(null)}>Fertig</Button>}>
          <div className="flex flex-col gap-3">
            <CopyField label="API-Schlüssel" value={created} />
            <p className="text-meta text-ink-3">Bewahre ihn wie ein Passwort auf. Verloren? Einfach widerrufen und neu erstellen.</p>
          </div>
        </Modal>
      )}
    </section>
  );
}

function McpSection() {
  const origin = window.location.origin;
  const url = `${origin}/api/mcp`;
  return (
    <SettingsSection
      title="Mit Claude verbinden (MCP)"
      description="Claude kann dann Fälligkeiten abfragen, Rundgänge planen, Mängel auswerten und Aufgaben anlegen – mit genau den Rechten, die du freigibst."
    >
      <Steps
        items={[
          {
            title: 'Adresse in Claude eintragen',
            text: 'In Claude (Web oder Desktop) unter Einstellungen → Connectors einen eigenen Connector hinzufügen und diese Adresse einfügen.',
            children: <CopyField label="MCP-Adresse" value={url} />,
          },
          {
            title: 'Verbinden und freigeben',
            text: (
              <>
                In Claude auf „Verbinden“ klicken. Es öffnet sich die Freigabeseite von Prüfkompass: dort die Rechte wählen (Nur lesen oder Lesen und schreiben) und erlauben – als Admin
                direkt, sonst mit einem API-Schlüssel. Die Verbindung erscheint danach oben als Schlüssel und lässt sich dort trennen.
              </>
            ),
          },
        ]}
      />
      <details className="group border-t border-line pt-4">
        <summary className="cursor-pointer list-none text-meta font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
          <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">›</span>
          Claude Code und andere Programme
        </summary>
        <div className="mt-4 flex flex-col gap-4 text-meta text-ink-3">
          <div className="flex flex-col gap-2">
            <p className="font-medium text-ink-2">Claude Code</p>
            <CodeBlock code={`claude mcp add --transport http pruefkompass ${url}`} />
            <p>Die Anmeldung läuft im Browser. Alternativ mit Schlüssel: --header "Authorization: Bearer pk_…"</p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-medium text-ink-2">Programme ohne Anmeldung im Browser</p>
            <CodeBlock code={`${url}/k/pk_…`} label="Adresse kopieren" />
            <p>Der Schlüssel steckt dann in der Adresse – behandle sie wie ein Passwort und lege dafür einen eigenen Schlüssel an.</p>
          </div>
          <div>
            <p className="mb-2 font-medium text-ink-2">Werkzeuge</p>
            <ul className="flex flex-wrap gap-1.5" aria-label="MCP-Werkzeuge">
              {MCP_TOOLS.map((t) => (
                <li key={t} className="rounded-md border border-line bg-canvas px-1.5 py-0.5 font-mono text-caption text-ink-2">
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </details>
    </SettingsSection>
  );
}

function RestSection() {
  const origin = window.location.origin;
  return (
    <SettingsSection title="REST-API" description="JSON über HTTPS mit denselben Daten wie in der App. Den Schlüssel als Bearer-Token mitschicken.">
      <CodeBlock code={`curl -H "Authorization: Bearer pk_…" ${origin}/api/assets?due=overdue`} />
      <dl className="-my-1 divide-y divide-line">
        {ENDPOINTS.map(([path, text]) => (
          <div key={path} className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-4">
            <dt className="shrink-0 font-mono text-caption text-ink sm:w-60">{path}</dt>
            <dd className="text-meta text-ink-3">{text}</dd>
          </div>
        ))}
      </dl>
      <Notice tone="muted">Konto, Team, Benachrichtigungen und Einstellungen sind per API nicht erreichbar. Änderungen per API erscheinen in der Aktivität mit dem Namen des Schlüssels.</Notice>
    </SettingsSection>
  );
}

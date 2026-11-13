// Einstellungen → API: Zugangsschlüssel, Verbindung mit Claude (MCP) in zwei Schritten, REST-Kurzreferenz.
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { useState } from "react";
import { api, queryClient, useAction } from "../../api";
import {
  CodeBlock,
  CopyField,
  SettingsSection,
  Steps,
} from "../../components/admin";
import {
  Button,
  ErrorBox,
  Field,
  Input,
  Menu,
  Modal,
  Select,
  Skeleton,
  Surface,
  useConfirm,
  useToast,
} from "../../components/ui";
import { fmtDate, fmtRelative } from "../../format";
import { MCP_PROMPTS, MCP_TOOLS } from "../../../shared/mcp";

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  scope: "read" | "write";
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  createdBy: string;
}

/** Was man Claude nach dem Verbinden sagen kann. */
const EXAMPLES = [
  "Was steht heute an?",
  "Los, Rundgang Haupthaus – Tür ist in Ordnung, nur der Schließer zieht nicht ganz zu, mittel.",
  "Lies die Typenschilder im Rathaus und trag Hersteller und Baujahr nach.",
];

/** Kurzreferenz der REST-Endpunkte: [Methode + Pfad, Beschreibung]. */
const ENDPOINTS: [string, string][] = [
  ["GET /api/properties", "Objekte; /:id mit Gebäuden und Elementen"],
  [
    "GET /api/assets",
    "Elemente; Filter due=overdue|soon|never, schedule, propertyId, q",
  ],
  [
    "GET /api/inspections",
    "Prüfungen; ?status=submitted, /:id mit Protokolldaten",
  ],
  ["GET /api/defects", "Mängel; ?status=open"],
  ["GET /api/tasks", "Aufgaben"],
  ["GET /api/export/assets.xlsx", "Elementliste als Excel (auch .csv)"],
  ["POST /api/assets, /api/tasks", "Anlegen – nur mit Schreibrechten"],
];

export function ApiTab() {
  return (
    <Surface>
      <KeysSection />
      <McpSection />
      <RestSection />
    </Surface>
  );
}

function KeysSection() {
  const toast = useToast();
  const [confirm, confirmEl] = useConfirm();
  const q = useQuery({
    queryKey: ["api-keys"],
    queryFn: () => api<ApiKeyRow[]>("/account/api-keys"),
  });
  const [form, setForm] = useState<{
    name: string;
    scope: "read" | "write";
    expiresInDays: number | "";
  } | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const create = useAction(
    () =>
      api<{ key: string }>("/account/api-keys", {
        body: {
          name: form!.name,
          scope: form!.scope,
          expiresInDays:
            form!.expiresInDays === "" ? null : form!.expiresInDays,
        },
      }),
    (r) => {
      setForm(null);
      setCreated(r.key);
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
    },
  );
  const revoke = useAction(
    (id: string) => api(`/account/api-keys/${id}`, { method: "DELETE" }),
    () => {
      queryClient.invalidateQueries({ queryKey: ["api-keys"] });
      toast("Schlüssel widerrufen");
    },
  );
  const keys = q.data ?? [];
  const active = keys.filter(
    (k) => !k.revokedAt && !(k.expiresAt && k.expiresAt < Date.now()),
  );
  const inactive = keys.filter((k) => !active.includes(k));
  const [showOld, setShowOld] = useState(false);
  const newKey = () => setForm({ name: "", scope: "read", expiresInDays: 365 });

  return (
    <SettingsSection
      title="API-Schlüssel"
      description="Für Fremdsysteme wie CAFM, ERP oder BI und für Verbindungen mit Claude. Ein Schlüssel handelt im Namen der Person, die ihn erstellt – höchstens mit Prüfer-Rechten; Schreib-Schlüssel von Admins dürfen zusätzlich neue Objekte und Gebäude anlegen."
    >
      {confirmEl}
      {revoke.error && <ErrorBox error={revoke.error} />}
      {q.isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : q.error ? (
        <ErrorBox error={q.error} onRetry={() => q.refetch()} />
      ) : (
        <div>
          <div className="flex items-center justify-between gap-3 pb-2">
            <span className="text-meta text-ink-3 tabular-nums">
              {active.length}{" "}
              {active.length === 1 ? "aktiver Schlüssel" : "aktive Schlüssel"}
            </span>
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus />}
              onClick={newKey}
            >
              Neuer Schlüssel
            </Button>
          </div>
          {!keys.length ? (
            <p className="border-t border-line pt-3 text-body text-ink-2">
              Noch keine Schlüssel. Lege einen an, um Prüfkompass mit anderen
              Systemen zu verbinden.
            </p>
          ) : (
            <ul
              className="divide-y divide-line border-t border-line"
              aria-label="Schlüssel"
            >
              {[...active, ...(showOld ? inactive : [])].map((k) => {
                const expired = !!k.expiresAt && k.expiresAt < Date.now();
                const off = !!k.revokedAt || expired;
                return (
                  <li
                    key={k.id}
                    className="flex min-h-14 items-center gap-3 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex min-w-0 items-baseline gap-2 text-body">
                        <span
                          className={
                            off
                              ? "truncate text-ink-3 line-through decoration-ink-4"
                              : "truncate"
                          }
                        >
                          {k.name}
                        </span>
                        <span className="shrink-0 font-mono text-caption text-ink-3">
                          {k.prefix}…
                        </span>
                      </p>
                      <p className="mt-0.5 truncate text-meta text-ink-3">
                        {k.lastUsedAt
                          ? `Zuletzt genutzt ${fmtRelative(k.lastUsedAt)}`
                          : "Noch nicht genutzt"}{" "}
                        · {k.createdBy} ·{" "}
                        {k.expiresAt
                          ? `gültig bis ${fmtDate(k.expiresAt)}`
                          : "ohne Ablauf"}
                      </p>
                    </div>
                    <span className="shrink-0 text-meta text-ink-3 max-sm:hidden">
                      {k.revokedAt
                        ? "Widerrufen"
                        : expired
                          ? "Abgelaufen"
                          : k.scope === "write"
                            ? "Lesen + Schreiben"
                            : "Nur lesen"}
                    </span>
                    {!k.revokedAt && (
                      <Menu
                        label={`Aktionen für ${k.name}`}
                        items={[
                          {
                            label: "Widerrufen",
                            danger: true,
                            onClick: async () => {
                              if (
                                await confirm({
                                  title: `„${k.name}“ widerrufen?`,
                                  text: "Systeme und Verbindungen, die diesen Schlüssel nutzen, verlieren sofort den Zugriff.",
                                  confirmLabel: "Widerrufen",
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
            <button
              type="button"
              onClick={() => setShowOld(!showOld)}
              className="min-h-10 border-t border-line pt-2 text-left text-meta font-medium text-ink-2 hover:text-ink w-full"
            >
              {showOld
                ? "Widerrufene und abgelaufene ausblenden"
                : `${inactive.length} widerrufene oder abgelaufene anzeigen`}
            </button>
          )}
        </div>
      )}

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
            <Field
              label="Name"
              hint="Wofür ist der Schlüssel? z. B. „CAFM Hausverwaltung“"
            >
              {(id) => (
                <Input
                  id={id}
                  required
                  minLength={2}
                  autoFocus
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              )}
            </Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Rechte">
                {(id) => (
                  <Select
                    id={id}
                    value={form.scope}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        scope: e.target.value as "read" | "write",
                      })
                    }
                  >
                    <option value="read">Nur lesen</option>
                    <option value="write">Lesen und schreiben</option>
                  </Select>
                )}
              </Field>
              <Field label="Gültigkeit">
                {(id) => (
                  <Select
                    id={id}
                    value={form.expiresInDays}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        expiresInDays:
                          e.target.value === "" ? "" : Number(e.target.value),
                      })
                    }
                  >
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
        <Modal
          title="Schlüssel erstellt"
          description="Nur jetzt sichtbar – danach nicht mehr abrufbar."
          onClose={() => setCreated(null)}
          footer={<Button onClick={() => setCreated(null)}>Fertig</Button>}
        >
          <div className="flex flex-col gap-3">
            <CopyField label="API-Schlüssel" value={created} />
            <p className="text-meta text-ink-3">
              Bewahre ihn wie ein Passwort auf. Verloren? Einfach widerrufen und
              neu erstellen.
            </p>
          </div>
        </Modal>
      )}
    </SettingsSection>
  );
}

function McpSection() {
  const origin = window.location.origin;
  const url = `${origin}/api/mcp`;
  return (
    <SettingsSection
      title="Mit Claude verbinden (MCP)"
      description="Claude hört zu, liest und sieht – Prüfkompass liefert die Werkzeuge: Lage abfragen, Rundgänge führen, Befunde eintragen, Typenschilder nachtragen. Unterschreiben bleibt immer bei dir in der App."
    >
      <Steps
        items={[
          {
            title: "Adresse in Claude eintragen",
            text: "In Claude (Web, Desktop oder Handy) unter Einstellungen → Connectors einen eigenen Connector hinzufügen und diese Adresse einfügen.",
            children: <CopyField label="MCP-Adresse" value={url} />,
          },
          {
            title: "Verbinden und freigeben",
            text: (
              <>
                In Claude auf „Verbinden“ tippen. Es öffnet sich die
                Freigabeseite von Prüfkompass: Rechte wählen (Nur lesen oder
                Lesen und schreiben) und erlauben – als Admin direkt, sonst mit
                einem API-Schlüssel. Die Verbindung erscheint danach oben als
                Schlüssel und lässt sich dort jederzeit trennen.
              </>
            ),
          },
          {
            title: "Einfach sagen, was du brauchst",
            text: (
              <ul className="mt-1 flex flex-col gap-1" aria-label="Beispiele">
                {EXAMPLES.map((e) => (
                  <li key={e} className="text-ink-2">
                    „{e}“
                  </li>
                ))}
              </ul>
            ),
          },
        ]}
      />
      <details className="group border-t border-line pt-4">
        <summary className="cursor-pointer list-none text-meta font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
          <span className="mr-1.5 inline-block transition-transform group-open:rotate-90">
            ›
          </span>
          Werkzeuge, Befehle und Claude Code
        </summary>
        <div className="mt-4 flex flex-col gap-5 text-meta text-ink-3">
          <div>
            <p className="mb-2 font-medium text-ink-2">Werkzeuge</p>
            <ul
              className="flex flex-col divide-y divide-line"
              aria-label="MCP-Werkzeuge"
            >
              {MCP_TOOLS.map(([name, purpose]) => (
                <li
                  key={name}
                  className="flex min-w-0 flex-col gap-0.5 py-1.5 sm:flex-row sm:gap-3"
                >
                  <span className="shrink-0 font-mono text-caption text-ink sm:w-32">
                    {name}
                  </span>
                  <span className="min-w-0">{purpose}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="mb-2 font-medium text-ink-2">
              Fertige Befehle in Claude
            </p>
            <p>{MCP_PROMPTS.join(" · ")}</p>
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-medium text-ink-2">Claude Code</p>
            <CodeBlock
              code={`claude mcp add --transport http pruefkompass ${url}`}
            />
            <p>
              Die Anmeldung läuft im Browser. Für Programme ohne
              Browser-Anmeldung: Schlüssel als Header mitschicken –
              Authorization: Bearer pk_…
            </p>
          </div>
        </div>
      </details>
    </SettingsSection>
  );
}

function RestSection() {
  const origin = window.location.origin;
  return (
    <SettingsSection
      title="REST-API"
      description="JSON über HTTPS mit denselben Daten wie in der App. Den Schlüssel als Bearer-Token mitschicken."
    >
      <CodeBlock
        code={`curl -H "Authorization: Bearer pk_…" ${origin}/api/assets?due=overdue`}
      />
      <dl className="-my-1 divide-y divide-line">
        {ENDPOINTS.map(([path, text]) => (
          <div
            key={path}
            className="flex flex-col gap-0.5 py-2.5 sm:flex-row sm:gap-4"
          >
            <dt className="shrink-0 font-mono text-caption text-ink sm:w-60">
              {path}
            </dt>
            <dd className="text-meta text-ink-3">{text}</dd>
          </div>
        ))}
      </dl>
      <p className="text-meta text-ink-3">
        Konto, Team, Benachrichtigungen und Einstellungen sind per API nicht
        erreichbar. Änderungen per API erscheinen in der Aktivität mit dem Namen
        des Schlüssels.
      </p>
    </SettingsSection>
  );
}

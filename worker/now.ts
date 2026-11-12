// „Jetzt“ (GET /now): eine Warteschlange für alles, was eine Entscheidung oder Handlung der angemeldeten Person braucht –
// im Zugriffsbereich, je Zeile genau eine Aktion, nach Dringlichkeit (shared/now.ts), höchstens 12 plus Anzahl „mehr“.
// Dieselben Quellen speisen die Alt-Pfade /smart/suggestions und /smart/action-required (worker/smart.ts) und das MCP.
import { Hono } from "hono";
import { DAY } from "../shared/logic";
import { NOW_LIMIT, type NowItem, NOW_VERBS, rankNow } from "../shared/now";
import { automationSuggestions } from "./automation";
import { defectScope, taskScope, tid } from "./data";
import { adaptMode, intervalSuggestions } from "./intervals";
import { type AppEnv, type Ctx, now, RANK, scopeSql, walkScope } from "./lib";

export const nowRoutes = new Hono<AppEnv>();

/** Bis zu so vielen Einzelzeilen, darüber eine Sammelzeile (Aufgaben, Entwürfe). */
const SINGLE_MAX = 3;
const plural = (n: number, one: string, many: string) =>
  n === 1 ? one : `${n} ${many}`;
const daysSince = (at: number, n: number) =>
  Math.max(1, Math.floor((n - at) / DAY));

/** Fällige Elemente je Gebäude (überfällig + Vorschau) im Zugriffsbereich, dringendste zuerst. */
export async function dueRounds(c: Ctx, days: number) {
  const n = now();
  const rows = (
    await c.env.DB.prepare(
      `SELECT a.id, a.code, a.category, a.location, a.floor, a.next_due_at AS nextDueAt,
              b.id AS buildingId, b.name AS buildingName, p.id AS propertyId, p.name AS propertyName
         FROM assets a JOIN buildings b ON b.id = a.building_id JOIN properties p ON p.id = b.property_id
        WHERE a.tenant_id = ?1 AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND p.deleted_at IS NULL
          AND (a.next_due_at IS NULL OR a.next_due_at < ?2) AND ${scopeSql(c, "b.id", "building")}
        ORDER BY p.name, b.name, a.floor, a.location, a.code LIMIT 2000`,
    )
      .bind(tid(c), n + days * DAY)
      .all<DueAsset>()
  ).results;
  const by = new Map<string, Round>();
  for (const r of rows) {
    const g = by.get(r.buildingId) ?? {
      buildingId: r.buildingId,
      buildingName: r.buildingName,
      propertyId: r.propertyId,
      propertyName: r.propertyName,
      overdue: 0,
      due: 0,
      never: 0,
      earliest: null,
      assets: [],
    };
    if (r.nextDueAt == null) g.never++;
    else if (r.nextDueAt < n) g.overdue++;
    else g.due++;
    if (r.nextDueAt != null && (g.earliest == null || r.nextDueAt < g.earliest))
      g.earliest = r.nextDueAt;
    g.assets.push(r);
    by.set(r.buildingId, g);
  }
  return [...by.values()].sort(
    (a, b) =>
      b.overdue - a.overdue ||
      (a.earliest ?? 0) - (b.earliest ?? 0) ||
      b.assets.length - a.assets.length,
  );
}
interface DueAsset {
  id: string;
  code: string;
  category: string;
  location: string;
  floor: string;
  nextDueAt: number | null;
  buildingId: string;
  buildingName: string;
  propertyId: string;
  propertyName: string;
}
export interface Round {
  buildingId: string;
  buildingName: string;
  propertyId: string;
  propertyName: string;
  overdue: number;
  due: number;
  never: number;
  earliest: number | null;
  assets: DueAsset[];
}

/**
 * Schwere offene Mängel ohne Aufgabe. Standard: ohne jede Aufgabe (genau für diese legt „Anlegen“ an);
 * `openOnly`: ohne offene Aufgabe (Alt-Pfad /smart/action-required, wie bisher).
 */
export function severeDefectsWithoutTask(c: Ctx, openOnly = false) {
  return c.env.DB.prepare(
    `SELECT d.id, d.title, d.severity, d.created_at AS createdAt, a.id AS assetId, a.code, p.name AS propertyName, b.name AS buildingName
       FROM defects d JOIN properties p ON p.id = d.property_id LEFT JOIN assets a ON a.id = d.asset_id LEFT JOIN buildings b ON b.id = a.building_id
      WHERE d.tenant_id = ?1 AND d.status = 'open' AND d.hidden_at IS NULL AND d.severity IN ('high','critical') AND p.deleted_at IS NULL
        AND (a.id IS NULL OR a.deleted_at IS NULL) AND ${defectScope(c, "d")}
        AND NOT EXISTS (SELECT 1 FROM tasks k WHERE k.defect_id = d.id ${openOnly ? "AND k.status IN ('open','in_progress')" : ""}) ORDER BY d.created_at LIMIT 300`,
  )
    .bind(tid(c))
    .all<{
      id: string;
      title: string;
      severity: string;
      createdAt: number;
      assetId: string | null;
      code: string | null;
      propertyName: string;
      buildingName: string | null;
    }>();
}

/** Überfällige offene Aufgaben im Bereich; `mine`: nur eigene und noch nicht vergebene. */
export function overdueTasks(c: Ctx, mine: boolean) {
  return c.env.DB.prepare(
    `SELECT k.id, k.title, k.kind, k.priority, k.due_at AS dueAt, u.name AS assigneeName, a.code
       FROM tasks k LEFT JOIN users u ON u.id = k.assignee_id LEFT JOIN assets a ON a.id = k.asset_id
      WHERE k.tenant_id = ?1 AND k.status IN ('open','in_progress') AND k.due_at < ?2 AND ${taskScope(c, "k")}
        AND (?3 = 0 OR k.assignee_id = ?4 OR (k.assignee_id IS NULL AND k.subcontractor_id IS NULL)) ORDER BY k.due_at LIMIT 300`,
  )
    .bind(tid(c), now(), mine ? 1 : 0, c.get("user").userId)
    .all<{
      id: string;
      title: string;
      kind: string;
      priority: string;
      dueAt: number;
      assigneeName: string | null;
      code: string | null;
    }>();
}

/** Alle Zeilen für die angemeldete Person (ungekürzt, unsortiert). Lesezugriff: nichts – es gibt nichts zu tun. */
export async function collectNow(c: Ctx): Promise<NowItem[]> {
  const u = c.get("user");
  if (RANK[u.role] < RANK.inspector) return [];
  const n = now();
  const t = tid(c);
  const [rounds, defects, tasks, drafts, sign, offline, walks, roundOrders] =
    await Promise.all([
      dueRounds(c, 14),
      severeDefectsWithoutTask(c),
      overdueTasks(c, true),
      c.env.DB.prepare(
        `SELECT i.id, i.updated_at AS updatedAt, a.code FROM inspections i JOIN assets a ON a.id = i.asset_id
        WHERE i.tenant_id = ? AND i.status = 'draft' AND i.inspector_id = ? AND i.updated_at < ? AND a.deleted_at IS NULL
          AND i.ready_at IS NULL ORDER BY i.updated_at LIMIT 20`,
      )
        .bind(t, u.userId, n - 2 * DAY)
        .all<{ id: string; updatedAt: number; code: string }>(),
      c.env.DB.prepare(
        "SELECT COUNT(*) AS n, MIN(ready_at) AS at FROM inspections WHERE tenant_id = ? AND status = 'draft' AND inspector_id = ? AND ready_at IS NOT NULL",
      )
        .bind(t, u.userId)
        .first<{ n: number; at: number | null }>(),
      c.env.DB.prepare(
        "SELECT COUNT(*) AS n, MIN(created_at) AS at FROM offline_failures WHERE tenant_id = ? AND user_id = ? AND resolved_at IS NULL",
      )
        .bind(t, u.userId)
        .first<{ n: number; at: number | null }>(),
      c.env.DB.prepare(
        `SELECT p.id, p.name, (SELECT MAX(w.next_due_at) FROM walkthroughs w WHERE w.property_id = p.id AND w.status = 'submitted' AND ${walkScope(c, "w")}) AS due
         FROM properties p WHERE p.tenant_id = ?1 AND p.deleted_at IS NULL AND ${scopeSql(c, "p.id", "fullProperty")}`,
      )
        .bind(t)
        .all<{ id: string; name: string; due: number | null }>(),
      // Rundgänge, die schon als Auftrag bei jemand anderem liegen, sind nicht meine Entscheidung
      c.env.DB.prepare(
        "SELECT building_id AS bid FROM tasks WHERE tenant_id = ? AND kind = 'inspection' AND building_id IS NOT NULL AND status IN ('open','in_progress') AND assignee_id IS NOT NULL AND assignee_id != ?",
      )
        .bind(t, u.userId)
        .all<{ bid: string }>(),
    ]);
  const out: NowItem[] = [];
  const action = (
    verb: NowItem["action"]["verb"],
    target: { link: string } | { endpoint: string; body?: unknown },
    label = NOW_VERBS[verb],
  ) => ({ verb, label, ...target });

  if (sign && sign.n > 0)
    out.push({
      id: "sign",
      kind: "sign",
      tone: "warn",
      title: `${sign.n} ${sign.n === 1 ? "Prüfung wartet" : "Prüfungen warten"} auf deine Unterschrift`,
      text: "Ausgefüllt und bereit – mit einer Unterschrift abschließen.",
      action: action("sign", { link: "/unterschreiben" }),
      count: sign.n,
    });
  if (offline && offline.n > 0)
    out.push({
      id: "offline-failures",
      kind: "offline_failures",
      tone: "bad",
      title: `${plural(offline.n, "Eine Offline-Prüfung", "Offline-Prüfungen")} nicht übernommen`,
      text: "Die Übertragung wurde abgelehnt. Prüfen und erneut senden.",
      action: action("open", { link: "/offline" }),
      count: offline.n,
      at: offline.at,
    });
  if (defects.results.length) {
    const k = defects.results.length;
    const crit = defects.results.filter(
      (d) => d.severity === "critical",
    ).length;
    out.push({
      id: "defects-without-task",
      kind: "defects_without_task",
      tone: crit ? "bad" : "warn",
      title: `${k} schwere ${k === 1 ? "Mangel" : "Mängel"} ohne Aufgabe`,
      text: crit
        ? `${crit} davon kritisch. Für jeden Mangel eine Aufgabe mit Frist anlegen.`
        : "Für jeden Mangel eine Aufgabe mit Frist anlegen.",
      action: action(
        "create",
        {
          endpoint: "/smart/tasks-from-defects",
          body: { severities: ["high", "critical"] },
        },
        "Aufgaben anlegen",
      ),
      count: k,
      at: defects.results[0].createdAt,
    });
  }
  const late = tasks.results;
  if (late.length > SINGLE_MAX)
    out.push({
      id: "overdue-tasks",
      kind: "overdue_tasks",
      tone: late.some((k) => k.priority === "high") ? "bad" : "warn",
      title: `${late.length} überfällige Aufgaben`,
      text: "Dir zugewiesen oder noch ohne Zuständige.",
      action: action("open", { link: "/aufgaben" }),
      count: late.length,
      at: late[0].dueAt,
    });
  else
    for (const k of late)
      out.push({
        id: `task-${k.id}`,
        kind: "overdue_tasks",
        tone: k.priority === "high" ? "bad" : "warn",
        title: k.title,
        text: `${k.assigneeName ? "Deine Aufgabe" : "Noch ohne Zuständige"}, seit ${plural(daysSince(k.dueAt, n), "einem Tag", "Tagen")} überfällig`,
        action: action("open", { link: `/aufgaben?id=${k.id}` }),
        count: 1,
        at: k.dueAt,
      });
  const taken = new Set(roundOrders.results.map((r) => r.bid));
  for (const g of rounds
    .filter((r) => (r.overdue || r.due) && !taken.has(r.buildingId))
    .slice(0, 3))
    out.push({
      id: `round-${g.buildingId}`,
      kind: "round",
      tone: g.overdue ? "bad" : "warn",
      title: `Rundgang ${g.buildingName}`,
      text: `${g.propertyName}: ${[g.overdue && `${g.overdue} überfällig`, g.due && `${g.due} in den nächsten 14 Tagen`, g.never && `${g.never} nie geprüft`].filter(Boolean).join(", ")}`,
      action: action("start", { link: `/rundgang/${g.buildingId}` }),
      count: g.overdue + g.due,
      at: g.earliest,
    });
  for (const w of walks.results) {
    if (w.due != null && w.due > n + 30 * DAY) continue;
    out.push({
      id: `walk-${w.id}`,
      kind: "walkthrough_due",
      tone: w.due == null || w.due < n ? "bad" : "warn",
      title: `Begehung ${w.name}`,
      text:
        w.due == null
          ? "Noch keine Begehung abgeschlossen."
          : w.due < n
            ? "Begehung ist überfällig."
            : "Begehung in den nächsten 30 Tagen fällig.",
      action: action("open", { link: `/objekte/${w.id}` }),
      count: 1,
      at: w.due,
    });
  }
  for (const s of await automationSuggestions(c))
    out.push({
      id: s.id,
      kind: "automation",
      automation: s.automation,
      tone: s.tone,
      title: s.title,
      text: s.text,
      action: s.action
        ? action(
            "run",
            {
              endpoint: s.action.endpoint,
              ...(s.action.body !== undefined ? { body: s.action.body } : {}),
            },
            s.action.label,
          )
        : action("open", { link: s.link ?? "/" }),
      count: s.count,
    });
  const d = drafts.results;
  if (d.length > SINGLE_MAX)
    out.push({
      id: "stale-drafts",
      kind: "stale_drafts",
      tone: "info",
      title: `${d.length} angefangene Prüfungen`,
      text: "Seit über zwei Tagen nicht abgeschlossen – fortsetzen oder verwerfen.",
      action: action("continue", { link: "/pruefungen?tab=drafts" }),
      count: d.length,
    });
  else
    for (const x of d)
      out.push({
        id: `draft-${x.id}`,
        kind: "stale_drafts",
        tone: "info",
        title: `Angefangene Prüfung ${x.code}`,
        text: "Seit über zwei Tagen nicht abgeschlossen.",
        action: action("continue", { link: `/pruefung/${x.id}` }),
        count: 1,
      });
  // Selbstanpassende Intervalle (Schritt „Lernen“ in Stufe „Vorschlagen“): nur wer sie übernehmen darf
  if (RANK[u.role] >= RANK.admin && (await adaptMode(c)) === "suggest") {
    for (const s of (await intervalSuggestions(c)).slice(0, 3))
      out.push({
        id: `interval-${s.assetId}-${s.schedule}`,
        kind: "interval",
        tone: s.kind === "shorten" ? "warn" : "info",
        title: `${s.code}: ${s.text}`,
        text: `${s.kind === "shorten" ? "Zwei Prüfungen in Folge mit Mängeln" : "Vier mängelfreie Prüfungen in Folge"} (${s.scheduleLabel}). ${[s.buildingName, s.propertyName].filter(Boolean).join(" · ")}`,
        action: action(
          "apply",
          {
            endpoint: "/smart/intervals/apply",
            body: { assetId: s.assetId, schedule: s.schedule, months: s.to },
          },
          s.kind === "shorten" ? "Verkürzen" : "Zurücksetzen",
        ),
        count: 1,
      });
  }
  return out;
}

/** Die Warteschlange: höchstens 12 Zeilen nach Dringlichkeit, `more` = Rest (`?limit=` bis 50 für „Alle“). */
nowRoutes.get("/now", async (c) => {
  const limit = Math.min(
    50,
    Math.max(1, Number(c.req.query("limit") ?? NOW_LIMIT) || NOW_LIMIT),
  );
  const items = await collectNow(c);
  const r = rankNow(items, now(), limit);
  return c.json({ items: r.items, more: r.more, total: items.length });
});

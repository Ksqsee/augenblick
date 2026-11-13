// E2E 08-security: stellt die Angriffswege aus dem Sicherheitsaudit nach und erwartet, dass sie blockiert sind.
// Nur lokal ausführen (legt einen zweiten Workspace an).
if (!process.env.DEMO_PASSWORD) throw new Error("DEMO_PASSWORD fehlt");
const BASE = process.env.BASE || "http://localhost:5173";
const PW = process.env.DEMO_PASSWORD;
const fail = [];
const check = (ok, m) => {
  if (!ok) {
    fail.push(m);
    console.log("  ✗", m);
  }
};

/** Minimaler Client mit Cookie-Sitzung. */
function client() {
  let cookie = "";
  const call = async (path, { method, body, headers = {} } = {}) => {
    const r = await fetch(BASE + "/api" + path, {
      method: method ?? (body !== undefined ? "POST" : "GET"),
      headers: {
        "x-pk": "1",
        cookie,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get("set-cookie");
    if (sc) cookie = sc.split(";")[0];
    const text = await r.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* kein JSON */
    }
    return { status: r.status, json, text, headers: r.headers };
  };
  call.login = (email, password = PW) =>
    call("/auth/login", { body: { email, password } });
  return call;
}

(async () => {
  if (process.env.PROD)
    throw new Error("08-security nicht gegen Produktion ausführen");
  const owner = client();
  check(
    (await owner.login("demo@example.com")).status === 200,
    "Login Inhaber",
  );

  console.log("· #1 Passwort-Link nicht workspace-übergreifend");
  const mallory = client();
  const reg = await mallory("/auth/register", {
    body: {
      company: "Mallory GmbH",
      name: "Mallory",
      email: `mallory${Date.now()}@example.com`,
      password: "mallory-passwort-1",
    },
  });
  check(reg.status === 200, `zweiter Workspace registriert (${reg.status})`);
  const inv = await mallory("/account/members/invite", {
    body: { email: "pruefer@example.com", role: "viewer" },
  });
  const victim = client();
  await victim.login("pruefer@example.com");
  const acc = await victim(`/auth/invite/${inv.json.token}`, {
    body: { password: PW },
  });
  check(acc.status === 200, `Opfer nimmt Einladung an (${acc.status})`);
  const members = (await mallory("/account/members")).json.members;
  const v = members.find((m) => m.email === "pruefer@example.com");
  const rl = await mallory(`/account/members/${v.id}/reset-link`, {
    method: "POST",
  });
  check(
    rl.status === 403,
    `Reset-Link für Mitglied anderer Workspaces abgelehnt (${rl.status})`,
  );
  // Admin darf keinen Link für einen anderen Admin erzeugen; Inhaber für Prüfer (nur hier Mitglied) schon
  const own = (await owner("/account/members")).json.members;
  const p2 = own.find((m) => m.email === "pruefer2@example.com");
  check(
    (await owner(`/account/members/${p2.id}/reset-link`, { method: "POST" }))
      .status === 200,
    "Inhaber erzeugt Link für eigenen Prüfer",
  );

  console.log("· #2 fremde Dateien über Begehungsfotos");
  const props = (await owner("/properties")).json;
  const w = await owner(`/properties/${props[0].id}/walkthroughs`, {
    body: {},
  });
  const wid = w.json?.id;
  const wd = (await owner(`/walkthroughs/${wid}`)).json;
  const q0 = wd.questions[0];
  const put = await owner(`/walkthroughs/${wid}`, {
    method: "PUT",
    body: {
      answers: { [q0.id]: "defect" },
      findings: [
        {
          questionId: q0.id,
          title: "x",
          note: "",
          severity: "low",
          photoKey: "fremderworkspace/geheim",
        },
      ],
      notes: "",
      participants: "",
      signature: null,
      signerName: "",
    },
  });
  check(put.status === 400, `fremder photoKey abgelehnt (${put.status})`);
  await owner(`/walkthroughs/${wid}`, { method: "DELETE" });

  console.log("· #3 Freigabe-Token nicht für Lesezugriff");
  const viewer = client();
  await viewer.login("lesen@example.com");
  const vt = (await viewer("/tasks")).json;
  check(
    Array.isArray(vt) && vt.length > 0 && vt.every((t) => t.shareToken == null),
    "Lesezugriff sieht keine Freigabe-Tokens",
  );
  const ot = (await owner("/tasks")).json;
  check(
    ot.some((t) => t.shareToken),
    "Inhaber sieht Freigabe-Tokens",
  );

  console.log("· #7 CSV-Formel-Injection");
  const asset = (await owner("/assets")).json[0];
  const detail = (await owner(`/assets/${asset.id}`)).json;
  const patched = await owner(`/assets/${asset.id}`, {
    method: "PATCH",
    body: {
      buildingId: detail.buildingId ?? asset.buildingId,
      location: '=HYPERLINK("http://evil.example/?x","x")',
      floor: detail.floor ?? "",
      manufacturer: detail.manufacturer ?? "",
      model: detail.model ?? "",
      attributes: detail.attributes ?? {},
    },
  });
  check(
    patched.status === 200,
    `Element mit Formel gespeichert (${patched.status} ${patched.text.slice(0, 80)})`,
  );
  const csv = (await owner("/export/assets.csv")).text;
  check(
    csv.includes(`"'=HYPERLINK(`) || csv.includes(`'=HYPERLINK(`),
    "Formel im CSV entschärft",
  );
  check(!/;"?=HYPERLINK/.test(csv), "keine Zelle beginnt mit =");

  console.log("· #8 Leseschlüssel kann keine Berichte löschen");
  const key = (
    await owner("/account/api-keys", {
      body: { name: "sec-test", scope: "read", expiresInDays: 1 },
    })
  ).json.key;
  const created = await fetch(
    `${BASE}/api/reports?kind=compliance&title=Sicherheitstest&fileName=t.pdf`,
    {
      method: "POST",
      headers: {
        "x-pk": "1",
        "content-type": "application/pdf",
        cookie: await (async () => {
          const r = await fetch(BASE + "/api/auth/login", {
            method: "POST",
            headers: { "x-pk": "1", "content-type": "application/json" },
            body: JSON.stringify({ email: "demo@example.com", password: PW }),
          });
          return r.headers.get("set-cookie").split(";")[0];
        })(),
      },
      body: "%PDF-1.4 test",
    },
  ).then((r) => r.json());
  const del = await fetch(`${BASE}/api/reports/${created.id}`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${key}` },
  });
  check(
    del.status === 403,
    `Bericht löschen mit Leseschlüssel verboten (${del.status})`,
  );

  console.log("· #10 Prüfer verwirft keine fremden Entwürfe");
  const insp = client();
  await insp.login("pruefer2@example.com");
  const a2 = (await owner("/assets")).json.find(
    (x) => x.category === "smoke_alarm",
  );
  const draft = await owner(`/assets/${a2.id}/inspections`, { body: {} });
  const did = draft.json.id ?? draft.json.inspection?.id;
  check(
    (await insp(`/inspections/${did}`, { method: "DELETE" })).status === 409,
    "fremder Entwurf nicht verwerfbar",
  );
  check(
    (await owner(`/inspections/${did}`, { method: "DELETE" })).status === 200,
    "eigener Entwurf verwerfbar",
  );

  console.log("· #11 Push nur an bekannte Dienste");
  const ps = await owner("/push/subscribe", {
    body: {
      endpoint: "https://intern.example.com/hook",
      keys: { p256dh: "x", auth: "y" },
    },
  });
  check(ps.status === 400, `beliebige Push-URL abgelehnt (${ps.status})`);

  console.log("· #12 Unterschrift nur als Bild");
  const d2 = await owner(`/assets/${a2.id}/inspections`, { body: {} });
  const d2id = d2.json.id ?? d2.json.inspection?.id;
  const sig = await owner(`/inspections/${d2id}`, {
    method: "PUT",
    body: {
      kind: "periodic",
      answers: {},
      signature: "https://tracker.example/pixel.gif",
    },
  });
  check(
    sig.status === 400,
    `externe Unterschrift-URL abgelehnt (${sig.status})`,
  );
  await owner(`/inspections/${d2id}`, { method: "DELETE" });

  console.log("· #4 Security-Header");
  const page = await fetch(BASE + "/login");
  const api = await fetch(BASE + "/api/health");
  console.log(
    `   Seite: CSP ${page.headers.get("content-security-policy") ? "ja" : "nein (Dev-Server liefert _headers nicht aus)"}`,
  );
  check(
    api.headers.get("x-frame-options") === "DENY" &&
      /sandbox/.test(api.headers.get("content-security-policy") ?? ""),
    "API-Header gesetzt",
  );

  console.log("· #16 API-Schlüssel nach Entfernen widerrufen");
  const k2 = (
    await insp("/account/api-keys", { body: { name: "x", scope: "read" } })
  ).status;
  check(k2 === 403, `Prüfer darf keine Schlüssel anlegen (${k2})`);

  console.log("· #25 Zugriffsbereich lässt sich nicht umgehen");
  const S = props[0];
  const oDefect = (await owner("/defects")).json.find(
    (d) => d.propertyId !== S.id,
  );
  const O = props.find((p) => p.id === oDefect.propertyId);
  const pid2 = (await owner("/account/members")).json.members.find(
    (m) => m.email === "pruefer2@example.com",
  ).id;
  check(
    (
      await owner(`/account/members/${pid2}/access`, {
        method: "PUT",
        body: {
          scope: { propertyIds: [S.id], buildingIds: [] },
          canCreate: true,
        },
      })
    ).status === 200,
    "Prüfer eingeschränkt",
  );
  const allA = (await owner("/assets")).json;
  const oAsset = allA.find((x) => x.propertyId === O.id);
  const sAsset = allA.find((x) => x.propertyId === S.id);
  // Mangel außerhalb des Bereichs über eine Aufgabe „erledigen“ (früher möglich: Aufgabe verknüpfen, dann auf erledigt setzen)
  let res = await insp("/tasks", {
    body: { title: "Umgehung", defectId: oDefect.id, status: "done" },
  });
  check(
    res.status === 404,
    `Aufgabe mit fremdem Mangel abgelehnt (${res.status})`,
  );
  check(
    (await owner("/defects")).json.some((d) => d.id === oDefect.id),
    "fremder Mangel bleibt offen",
  );
  const ownTask = await insp("/tasks", {
    body: { title: "Eigene Aufgabe", propertyId: S.id },
  });
  res = await insp(`/tasks/${ownTask.json.id}`, {
    method: "PATCH",
    body: {
      title: "Eigene Aufgabe",
      propertyId: S.id,
      defectId: oDefect.id,
      status: "done",
    },
  });
  check(
    res.status === 404,
    `fremden Mangel nachträglich verknüpfen abgelehnt (${res.status})`,
  );
  // Existenz nicht erkennbar: unbekannt und außerhalb des Bereichs liefern dieselbe Antwort
  const ghost = await insp("/tasks", {
    body: { title: "x", defectId: "zzzzzzzzzzzzzzzz" },
  });
  const foreign = await insp("/tasks", {
    body: { title: "x", assetId: oAsset.id },
  });
  check(
    ghost.status === 404 &&
      foreign.status === 404 &&
      ghost.json.error ===
        (await insp("/tasks", { body: { title: "x", defectId: oDefect.id } }))
          .json.error,
    "kein Existenz-Orakel über Aufgaben",
  );
  // Offline-Abgleich mit fremdem Element
  res = await insp("/inspections/offline", {
    body: {
      clientId: `sec-${Date.now()}`,
      assetId: oAsset.id,
      schedule: "main",
      inspectedAt: Date.now(),
      checkpoints: [{ id: "a", label: "A" }],
      kinds: ["periodic"],
      answers: { a: "ok" },
      signature: "data:image/png;base64,AAAA",
      signerName: "x",
    },
  });
  check(
    res.status === 404,
    `Offline-Prüfung an fremdem Element abgelehnt (${res.status})`,
  );
  // Etikett-Konflikt verrät nicht den Code eines fremden Elements
  await owner(`/assets/${oAsset.id}/label`, {
    method: "PUT",
    body: { labelCode: "SEC-LABEL-21" },
  });
  res = await insp(`/assets/${sAsset.id}/label`, {
    method: "PUT",
    body: { labelCode: "SEC-LABEL-21" },
  });
  check(
    res.status === 409 && !res.text.includes(oAsset.code),
    `Etikett-Konflikt ohne fremden Code (${res.status} ${res.text})`,
  );
  // Berichtsarchiv: workspace-weite und fremde Objektberichte nicht abrufbar
  const ownerCookie = await (async () => {
    const lr = await fetch(BASE + "/api/auth/login", {
      method: "POST",
      headers: { "x-pk": "1", "content-type": "application/json" },
      body: JSON.stringify({ email: "demo@example.com", password: PW }),
    });
    return lr.headers.get("set-cookie").split(";")[0];
  })();
  const oReport = await fetch(
    `${BASE}/api/reports?kind=property&title=Fremd&fileName=f.pdf&propertyId=${O.id}`,
    {
      method: "POST",
      headers: {
        "x-pk": "1",
        "content-type": "application/pdf",
        cookie: ownerCookie,
      },
      body: "%PDF-1.4 fremd",
    },
  ).then((r) => r.json());
  const list = (await insp("/reports")).json;
  check(
    !list.some((x) => x.id === oReport.id || x.id === created.id),
    "Archiv zeigt keine fremden bzw. workspace-weiten Berichte",
  );
  check(
    (await insp(`/reports/${oReport.id}/file`)).status === 404 &&
      (await insp(`/reports/${created.id}/file`)).status === 404,
    "fremde Berichte nicht herunterladbar",
  );
  res = await fetch(
    `${BASE}/api/reports?kind=compliance&title=x&fileName=x.pdf`,
    {
      method: "POST",
      headers: {
        "x-pk": "1",
        "content-type": "application/pdf",
        cookie: await (async () => {
          const lr = await fetch(BASE + "/api/auth/login", {
            method: "POST",
            headers: { "x-pk": "1", "content-type": "application/json" },
            body: JSON.stringify({
              email: "pruefer2@example.com",
              password: PW,
            }),
          });
          return lr.headers.get("set-cookie").split(";")[0];
        })(),
      },
      body: "%PDF-1.4 x",
    },
  );
  check(
    res.status === 404,
    `eingeschränkt: kein workspace-weiter Bericht (${res.status})`,
  );
  // Aktivitätsprotokoll und Mitgliederliste geben keine fremden Bereiche preis
  const acts = (await insp("/account/activity")).json;
  check(
    acts.every((x) => x.userName === "Aylin Demir"),
    "Aktivitätsprotokoll nur eigene Einträge",
  );
  check(
    (await insp("/account/members")).json.members.every(
      (m) => m.email === "pruefer2@example.com" || m.scope === null,
    ),
    "Bereiche anderer nicht sichtbar",
  );
  // Rolle/Bereich selbst ändern geht nicht
  check(
    (
      await insp(`/account/members/${pid2}/access`, {
        method: "PUT",
        body: { scope: null, canCreate: true },
      })
    ).status === 403,
    "eigenen Bereich nicht selbst aufheben",
  );
  console.log("· #26 Aufgaben und Mängel: Rollen und Workspace-Grenzen");
  const reader = client();
  await reader.login("lesen@example.com");
  const myDefect = (await owner("/defects")).json[0];
  check(
    (await reader(`/defects/${myDefect.id}/hide`, { body: { reason: "x" } }))
      .status === 403,
    "Lesezugriff blendet nicht aus",
  );
  const ih = await insp(`/defects/${myDefect.id}/hide`, {
    body: { reason: "x" },
  });
  check(
    ih.status === 403,
    `Prüfer blendet nicht aus (${ih.status} ${ih.text.slice(0, 80)})`,
  );
  check(
    (
      await reader(`/defects/${myDefect.id}`, {
        method: "PATCH",
        body: { status: "resolved", note: "x" },
      })
    ).status === 403,
    "Lesezugriff behebt nicht",
  );
  check(
    (await reader("/tasks/bulk", { body: { ids: ["x"], status: "done" } }))
      .status === 403,
    "Lesezugriff ohne Mehrfachbearbeitung",
  );
  // Daten im fremden Workspace (Mallory) anlegen
  const mProp = (
    await mallory("/properties", { body: { name: "Mallory Objekt" } })
  ).json.id;
  const mDefect = (
    await mallory("/defects", {
      body: { propertyId: mProp, title: "Fremder Mangel", severity: "low" },
    })
  ).json.id;
  const mTask = (
    await mallory("/tasks", {
      body: { title: "Fremde Aufgabe", propertyId: mProp },
    })
  ).json.id;
  check(!!mDefect && !!mTask, "Fremde Daten angelegt");
  const malloryId = (await mallory("/account/me")).json.user.id;
  check(
    (await owner(`/defects/${mDefect}`)).status === 404,
    "fremder Mangel-Detail → 404",
  );
  check(
    (await owner(`/defects/${mDefect}/hide`, { body: { reason: "x" } }))
      .status === 404,
    "fremden Mangel ausblenden → 404",
  );
  check(
    (
      await owner(`/defects/${mDefect}`, {
        method: "PATCH",
        body: { status: "resolved" },
      })
    ).status === 404,
    "fremden Mangel beheben → 404",
  );
  check(
    (await owner(`/tasks/${mTask}/watchers`)).status === 404,
    "fremde Beobachter → 404",
  );
  check(
    (await owner(`/tasks/${mTask}/watch`, { method: "POST" })).status === 404,
    "fremde Aufgabe beobachten → 404",
  );
  check(
    (await owner(`/tasks/${mTask}/comments`, { body: { body: "x" } }))
      .status === 404,
    "fremde Aufgabe kommentieren → 404",
  );
  check(
    (await owner("/tasks/bulk", { body: { ids: [mTask], status: "done" } }))
      .status === 404,
    "fremde Aufgabe in Mehrfachbearbeitung → 404",
  );
  check(
    (await mallory("/tasks")).json.find((t) => t.id === mTask)?.status ===
      "open",
    "fremde Aufgabe unverändert",
  );
  const mentionTask = (
    await owner("/tasks", { body: { title: "Sicherheitstest Erwähnung" } })
  ).json.id;
  const men = await owner(`/tasks/${mentionTask}/comments`, {
    body: { body: "@Mallory", mentions: [malloryId] },
  });
  check(
    men.status === 400,
    `Erwähnung eines Nicht-Mitglieds abgelehnt (${men.status})`,
  );
  check(
    !(await mallory("/notifications")).json.items.some((x) =>
      /Sicherheitstest/.test(x.title),
    ),
    "keine Meldung an Nicht-Mitglied",
  );
  check(
    (await owner("/tasks", { body: { title: "x", defectId: mDefect } }))
      .status === 400,
    "Aufgabe mit fremdem Mangel abgelehnt",
  );
  const fk = await owner(`/defects/${myDefect.id}`, {
    method: "PATCH",
    body: { status: "resolved", photoKey: `${"x".repeat(8)}/fremd` },
  });
  check(
    fk.status === 400,
    `fremder Foto-Schlüssel bei Behebung abgelehnt (${fk.status})`,
  );

  console.log(
    "· #27 Offline-Fehlliste, Intervalle, Partner-Zugang: Workspace-Grenzen und Rollen",
  );
  const SIG1 =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const offlineFail = (assetId) => ({
    clientId: `sec27-${Math.random().toString(36).slice(2, 12)}`,
    assetId,
    schedule: "main",
    inspectedAt: Date.now(),
    checkpoints: [{ id: "a", label: "A" }],
    kinds: ["periodic"],
    answers: { a: "ok" },
    signature: SIG1,
    signerName: "x",
  });
  // Abgelehnte Übertragung eines eingeschränkten Prüfers an ein Element außerhalb seines Bereichs: gemerkt, aber ohne fremden Code
  const scopedFail = await insp("/inspections/offline", {
    body: offlineFail(oAsset.id),
  });
  check(
    scopedFail.status === 404 && !!scopedFail.json?.failureId,
    `Ablehnung gemerkt (${scopedFail.status})`,
  );
  const scopedRow = (await insp("/offline/failures")).json.find(
    (x) => x.id === scopedFail.json.failureId,
  );
  check(
    scopedRow &&
      scopedRow.assetCode === "" &&
      !JSON.stringify(scopedRow).includes(oAsset.code),
    "Eintrag verrät keinen Code außerhalb des Bereichs",
  );
  check(
    (
      await insp(`/offline/failures/${scopedFail.json.failureId}/retry`, {
        body: { assetId: oAsset.id },
      })
    ).status === 404,
    "Ersatz-Element außerhalb des Bereichs → 404",
  );
  const ownFail = await owner("/inspections/offline", {
    body: offlineFail("zzzzzzzzzzzzzzzz"),
  });
  const ofid = ownFail.json?.failureId;
  check(
    ownFail.status === 404 && !!ofid,
    `Admin-Ablehnung gemerkt (${ownFail.status})`,
  );
  check(
    !(await mallory("/offline/failures")).json.some((x) => x.id === ofid),
    "fremder Workspace sieht die Liste nicht",
  );
  check(
    (await mallory(`/offline/failures/${ofid}/retry`, { body: {} })).status ===
      404,
    "fremden Eintrag erneut versuchen → 404",
  );
  check(
    (await mallory(`/offline/failures/${ofid}`, { method: "DELETE" }))
      .status === 404,
    "fremden Eintrag löschen → 404",
  );
  check(
    !(await insp("/offline/failures")).json.some((x) => x.id === ofid),
    "Prüfer sieht Einträge anderer nicht",
  );
  check(
    (await insp(`/offline/failures/${ofid}/retry`, { body: {} })).status ===
      404,
    "Prüfer versucht fremden Eintrag nicht erneut",
  );
  check(
    (await insp(`/offline/failures/${ofid}`, { method: "DELETE" })).status ===
      404,
    "Prüfer löscht fremden Eintrag nicht",
  );
  check(
    (await reader(`/offline/failures/${ofid}/retry`, { body: {} })).status ===
      403,
    "Lesezugriff versucht nicht erneut",
  );
  check(
    (await reader("/offline/failures")).status === 403,
    "Lesezugriff ohne Fehlliste",
  );
  // Ersatz-Element aus fremdem Workspace
  const mBuilding = (
    await mallory(`/properties/${mProp}/buildings`, {
      body: { name: "Mallory Haus" },
    })
  ).json?.id;
  const mAsset =
    mBuilding &&
    (
      await mallory("/assets", {
        body: { buildingId: mBuilding, category: "smoke_alarm" },
      })
    ).json?.id;
  check(!!mAsset, "fremdes Element angelegt");
  check(
    (
      await owner(`/offline/failures/${ofid}/retry`, {
        body: { assetId: mAsset },
      })
    ).status === 404,
    "Ersatz-Element aus fremdem Workspace → 404",
  );
  check(
    (await owner(`/offline/failures/${ofid}`, { method: "DELETE" })).status ===
      200,
    "eigenen Eintrag gelöscht",
  );
  // Intervalle: fremde Elemente und Rollen
  check(
    (
      await mallory("/smart/intervals/apply", {
        body: { assetId: sAsset.id, schedule: "main", months: 6 },
      })
    ).status === 404,
    "Intervall fremdes Element anpassen → 404",
  );
  check(
    (
      await mallory("/smart/intervals/reset", {
        body: { assetId: sAsset.id, schedule: "main" },
      })
    ).status === 404,
    "Intervall fremdes Element zurücksetzen → 404",
  );
  check(
    (await mallory(`/smart/intervals?assetId=${sAsset.id}`)).json.suggestions
      .length === 0,
    "keine Vorschläge zu fremden Elementen",
  );
  check(
    (
      await owner("/smart/intervals/apply", {
        body: { assetId: mAsset, schedule: "main", months: 6 },
      })
    ).status === 404,
    "Element aus fremdem Workspace → 404",
  );
  check(
    (
      await insp("/smart/intervals/reset", {
        body: { assetId: sAsset.id, schedule: "main" },
      })
    ).status === 403,
    "Prüfer setzt Intervall nicht zurück",
  );
  // Partner-Zugang
  const ownSub = (await owner("/subcontractors")).json[0];
  check(
    (
      await mallory(`/subcontractors/${ownSub.id}/partner-code`, {
        method: "POST",
      })
    ).status === 404,
    "Partner-Code für fremden Subunternehmer → 404",
  );
  check(
    (
      await mallory(`/subcontractors/${ownSub.id}/partner-code`, {
        method: "DELETE",
      })
    ).status === 404,
    "fremden Partner-Code widerrufen → 404",
  );
  check(
    (
      await insp(`/subcontractors/${ownSub.id}/partner-code`, {
        method: "POST",
      })
    ).status === 403,
    "Prüfer erzeugt keinen Partner-Code",
  );
  const pcode = (
    await owner(`/subcontractors/${ownSub.id}/partner-code`, { method: "POST" })
  ).json.code;
  const pub = async (path, init) =>
    (await fetch(`${BASE}/api/public/partner/${path}`, init)).status;
  check((await pub(pcode)) === 200, "Partner-Code gültig");
  check(
    (await pub(`${pcode.slice(0, -2)}xx`)) === 404,
    "veränderter Code → 404",
  );
  check((await pub("kurz")) === 404, "zu kurzer Code → 404");
  const mSub = (
    await mallory("/subcontractors", { body: { company: "Mallory Partner" } })
  ).json.id;
  const mCode = (
    await mallory(`/subcontractors/${mSub}/partner-code`, { method: "POST" })
  ).json.code;
  const mView = await (
    await fetch(`${BASE}/api/public/partner/${mCode}`)
  ).json();
  check(
    mView.company === "Mallory Partner" && mView.tasks.length === 0,
    "Partner-Seite zeigt nur Aufträge der eigenen Firma",
  );
  const ownView = await (
    await fetch(`${BASE}/api/public/partner/${pcode}`)
  ).json();
  const someRef = ownView.tasks[0]?.ref;
  if (someRef)
    check(
      (await pub(`${mCode}/tasks/${someRef}`)) === 404,
      "Auftrag fremder Firma über eigenen Code → 404",
    );
  check(
    (
      await owner(`/subcontractors/${ownSub.id}/partner-code`, {
        method: "DELETE",
      })
    ).status === 200,
    "Partner-Code widerrufen",
  );
  check((await pub(pcode)) === 404, "widerrufener Code → 404");
  if (someRef) {
    const st = await pub(`${pcode}/tasks/${someRef}`, {
      method: "POST",
      headers: { "x-pk": "1", "content-type": "application/json" },
      body: JSON.stringify({ status: "done" }),
    });
    check(st === 404, "Rückmeldung mit widerrufenem Code → 404");
  }

  console.log(
    "· #28 Prüfen smart: bekannte Mängel nur des eigenen Elements, Bilderkennung",
  );
  {
    const SIG =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const other = (await owner("/defects")).json.find(
      (d) => d.assetId && d.status === "open",
    );
    const target = (await owner("/assets")).json.find(
      (a) => a.id !== other.assetId,
    );
    const started = (
      await owner(`/assets/${target.id}/inspections`, { body: {} })
    ).json;
    const draft = (await owner(`/inspections/${started.id}`)).json;
    check(
      !draft.knownDefects.some((k) => k.id === other.id),
      "Mängel anderer Elemente erscheinen nicht als bekannt",
    );
    const sub = await owner(`/inspections/${draft.id}/submit`, {
      body: {
        kinds: draft.kinds,
        answers: Object.fromEntries(draft.checkpoints.map((c) => [c.id, "ok"])),
        defects: [
          {
            title: "Sicherheitstest fremde Verknüpfung",
            note: "",
            severity: "low",
            knownId: other.id,
          },
        ],
        resolvedDefects: [other.id, mDefect],
        signature: SIG,
      },
    });
    check(
      sub.status === 200,
      `Abschluss mit fremden IDs läuft durch (${sub.status})`,
    );
    check(
      (await owner(`/defects/${other.id}`)).json?.status === "open",
      "Mangel eines anderen Elements bleibt offen",
    );
    check(
      (await mallory(`/defects/${mDefect}`)).json?.status === "open",
      "Mangel eines anderen Workspaces bleibt offen",
    );
    const mine = (await owner(`/assets/${target.id}`)).json.defects.filter(
      (d) => d.title === "Sicherheitstest fremde Verknüpfung",
    );
    check(
      mine.length === 1,
      "fremde Verknüpfung ignoriert → eigener neuer Mangel",
    );
    // Bilderkennung im Worker gibt es nicht mehr (keine KI-Kosten); Fotos sieht nur Claude über get_photo
    check(
      (await reader("/ai/identify", { body: { key: "x/y" } })).status === 404,
      "Bilderkennung entfernt",
    );
  }

  console.log("· #29 Autopilot: Rollen, Workspace-Grenzen und Zugriffsbereich");
  check(
    (
      await reader("/automation", {
        method: "PUT",
        body: { key: "plan_week", mode: "auto" },
      })
    ).status === 403,
    "Lesezugriff ändert keine Regel",
  );
  check(
    (
      await insp("/automation", {
        method: "PUT",
        body: { key: "plan_week", mode: "auto" },
      })
    ).status === 403,
    "Prüfer ändert keine Regel",
  );
  check(
    (
      await insp("/automation", {
        method: "PUT",
        body: { key: "adapt_intervals", mode: "auto" },
      })
    ).status === 403,
    "Prüfer ändert die Intervall-Stufe nicht",
  );
  check(
    (
      await owner("/automation", {
        method: "PUT",
        body: { key: "adapt_intervals", config: { rules: [] } },
      })
    ).status === 400,
    "Intervall-Regel ohne Einstellungen",
  );
  check(
    (await reader("/automation/plan_week/run", { body: {} })).status === 403,
    "Lesezugriff führt keine Regel aus",
  );
  check(
    (await insp("/automation/monthly-report/claim", { body: {} })).status ===
      403,
    "Prüfer reserviert keine Monatsberichte",
  );
  check(
    !("config" in (await insp("/automation")).json[0]),
    "Zuweisungsregeln nur für Admins sichtbar",
  );
  // Rückgängig-Schlüssel kommen nicht von außen: unbekannter Schlüssel → 400
  check(
    (
      await owner("/automation", {
        method: "PUT",
        body: { key: "drop_tables", mode: "auto" },
      })
    ).status === 400,
    "unbekannte Regel abgelehnt",
  );
  // Zuweisung an ein Nicht-Mitglied (fremder Workspace) abgelehnt
  const badRule = await owner("/automation", {
    method: "PUT",
    body: {
      key: "assign_defect_tasks",
      config: { rules: [{ severities: ["high"], assigneeId: malloryId }] },
    },
  });
  check(
    badRule.status === 400,
    `Zuweisungsregel an Nicht-Mitglied abgelehnt (${badRule.status})`,
  );
  // Je ein Protokolleintrag im Bereich (S) und außerhalb (O)
  const inside = await owner("/defects", {
    body: {
      assetId: sAsset.id,
      title: "Autopilot innen",
      severity: "critical",
      force: true,
    },
  });
  const outside = await owner("/defects", {
    body: {
      assetId: oAsset.id,
      title: "Autopilot außen",
      severity: "critical",
      force: true,
    },
  });
  check(
    inside.json?.taskCreated && outside.json?.taskCreated,
    "Autopilot legt Aufgaben an",
  );
  const ownerLog = (await owner("/automation/log")).json;
  const logIn = ownerLog.find((e) => e.summary.includes("Autopilot innen"));
  const logOut = ownerLog.find((e) => e.summary.includes("Autopilot außen"));
  check(
    !!logIn && !!logOut,
    `Protokolleinträge vorhanden (${ownerLog.map((e) => e.summary)})`,
  );
  const inspLog = (await insp("/automation/log")).json;
  check(
    inspLog.some((e) => e.id === logIn?.id) &&
      !inspLog.some((e) => e.id === logOut?.id),
    "eingeschränkt: Protokoll nur im Bereich",
  );
  check(
    (await insp(`/automation/log/${logOut.id}/undo`, { body: {} })).status ===
      404,
    "Rückgängig außerhalb des Bereichs → 404",
  );
  check(
    (await insp(`/automation/log/${logIn.id}/undo`, { body: {} })).status ===
      403,
    "Rückgängig nur für Admins oder Zuständige",
  );
  const ru = await reader(`/automation/log/${logIn.id}/undo`, { body: {} });
  check(
    ru.status === 403,
    `Lesezugriff macht nichts rückgängig (${ru.status} ${ru.text.slice(0, 80)})`,
  );
  check(
    (await mallory(`/automation/log/${logIn.id}/undo`, { body: {} })).status ===
      404,
    "Rückgängig im fremden Workspace → 404",
  );
  check(
    !(await mallory("/automation/log")).json.some((e) => e.id === logIn.id),
    "fremdes Protokoll unsichtbar",
  );
  check(
    (await owner(`/automation/log/${logIn.id}/undo`, { body: {} })).status ===
      200,
    "Admin macht rückgängig",
  );
  check(
    (await owner(`/automation/log/${logIn.id}/undo`, { body: {} })).status ===
      409,
    "zweites Rückgängig → 409",
  );
  check(
    (
      await mallory("/automation/monthly-report/zzzzzzzzzzzzzzzz/complete", {
        body: { reportIds: [created.id] },
      })
    ).status === 404,
    "fremde Reservierung → 404",
  );

  console.log(
    "· #30 MCP: get_photo, capture, update_asset, inspect – Rechte und Workspace-Grenzen; Unterschrift nur in der App",
  );
  {
    const SIG =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const png = Buffer.from(SIG.split(",")[1], "base64");
    const ownerWrite = (
      await owner("/account/api-keys", {
        body: { name: "sec-mcp", scope: "write", expiresInDays: 1 },
      })
    ).json.key;
    const ownerRead = key; // Leseschlüssel aus #8
    const malloryKey = (
      await mallory("/account/api-keys", {
        body: { name: "mallory-mcp", scope: "write", expiresInDays: 1 },
      })
    ).json.key;
    const tool = async (k, name, args) => {
      const r = await fetch(BASE + "/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${k}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }).then((x) => x.json());
      return {
        isError: r.result?.isError,
        content: r.result?.content ?? [],
        text: r.result?.content?.[0]?.text ?? "",
      };
    };
    // Fotos beider Workspaces
    const putFile = async (cookieClient) => {
      const r = await fetch(BASE + "/api/files", {
        method: "POST",
        headers: {
          "x-pk": "1",
          "content-type": "image/png",
          cookie: cookieClient,
        },
        body: png,
      });
      return (await r.json()).key;
    };
    const malloryCookie = await (async () => {
      const me = (await mallory("/account/me")).json.user.email;
      const lr = await fetch(BASE + "/api/auth/login", {
        method: "POST",
        headers: { "x-pk": "1", "content-type": "application/json" },
        body: JSON.stringify({ email: me, password: "mallory-passwort-1" }),
      });
      return lr.headers.get("set-cookie").split(";")[0];
    })();
    const ownKey = await putFile(ownerCookie);
    const mKey = await putFile(malloryCookie);
    let t = await tool(malloryKey, "get_photo", { ref: `foto:${ownKey}` });
    check(
      t.isError === true && !t.content.some((x) => x.type === "image"),
      "get_photo: fremdes Foto nicht lesbar",
    );
    t = await tool(ownerWrite, "get_photo", { ref: `foto:${mKey}` });
    check(
      t.isError === true && !t.content.some((x) => x.type === "image"),
      "get_photo: Foto aus fremdem Workspace nicht lesbar",
    );
    for (const ref of [
      "foto:../secret",
      `foto:${ownKey}/../x`,
      "plan:../../x",
      `plan:${"z".repeat(16)}`,
    ]) {
      t = await tool(ownerWrite, "get_photo", { ref });
      check(t.isError === true, `get_photo lehnt „${ref}“ ab`);
    }
    t = await tool(ownerWrite, "get_photo", { ref: `foto:${ownKey}` });
    check(
      t.content.some((x) => x.type === "image"),
      "get_photo: eigenes Foto lesbar",
    );
    // capture / update_asset / inspect über Workspace-Grenzen und mit Leseschlüssel
    t = await tool(malloryKey, "capture", {
      asset: sAsset.code,
      items: [
        { kind: "defect", title: "Fremd eingeschleust", severity: "critical" },
      ],
    });
    check(
      t.isError === true &&
        !(await owner("/defects")).json.some(
          (d) => d.title === "Fremd eingeschleust",
        ),
      "capture: kein Mangel an fremdem Element",
    );
    t = await tool(malloryKey, "capture", {
      property: S.name,
      items: [{ kind: "task", title: "Fremde Aufgabe per MCP" }],
    });
    check(
      t.isError === true &&
        !(await owner("/tasks")).json.some(
          (x) => x.title === "Fremde Aufgabe per MCP",
        ),
      "capture: keine Aufgabe in fremdem Objekt",
    );
    t = await tool(ownerRead, "capture", {
      asset: sAsset.code,
      items: [
        { kind: "defect", title: "Lesend eingeschleust", severity: "low" },
        { kind: "asset", category: "smoke_alarm", building: "x" },
      ],
    });
    check(
      t.isError === true &&
        !(await owner("/defects")).json.some(
          (d) => d.title === "Lesend eingeschleust",
        ),
      "capture: Leseschlüssel legt nichts an",
    );
    const before = (await owner(`/assets/${sAsset.id}`)).json;
    t = await tool(malloryKey, "update_asset", {
      asset: sAsset.code,
      manufacturer: "Mallory",
    });
    check(t.isError === true, "update_asset: fremdes Element nicht änderbar");
    t = await tool(ownerRead, "update_asset", {
      asset: sAsset.code,
      manufacturer: "Lesend",
    });
    check(t.isError === true, "update_asset: nicht mit Leseschlüssel");
    t = await tool(ownerWrite, "update_asset", {
      asset: sAsset.code,
      fields: { __proto__: 1, constructor: "x" },
    });
    const after = (await owner(`/assets/${sAsset.id}`)).json;
    check(
      after.manufacturer === before.manufacturer &&
        JSON.stringify(after.attributes) === JSON.stringify(before.attributes),
      "Stammdaten unverändert (auch keine Fremdfelder)",
    );
    t = await tool(malloryKey, "inspect", { asset: sAsset.code, allOk: true });
    check(t.isError === true, "inspect: fremdes Element nicht prüfbar");
    // Mallory ist Inhaberin ihres Workspaces: setup legt Objekt/Gebäude dort an (#33) – nie bei uns
    t = await tool(malloryKey, "setup", {
      preview: false,
      property: { name: S.name },
      buildings: [
        { name: "Mallory Anbau", elements: [{ category: "smoke_alarm" }] },
      ],
    });
    check(
      !(await owner("/assets")).json.some(
        (a) => a.buildingName === "Mallory Anbau",
      ),
      "setup: nichts im fremden Workspace",
    );
    check(
      (await owner("/properties")).json.filter((p) => p.name === S.name)
        .length === 1,
      "setup: kein zweites Objekt gleichen Namens bei uns",
    );
    // Unterschrift: nie per Schlüssel, nur eigene, bereite Entwürfe
    t = await tool(ownerWrite, "inspect", { asset: sAsset.code, allOk: true });
    const readyId = JSON.parse(t.text || "{}").inspectionId;
    check(!!readyId, `inspect legt bereit (${t.text.slice(0, 80)})`);
    const viaKey = await fetch(BASE + "/api/inspections/sign", {
      method: "POST",
      headers: {
        authorization: `Bearer ${ownerWrite}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ids: [readyId], signature: SIG }),
    });
    check(
      viaKey.status === 403,
      `Sammel-Unterschrift mit API-Schlüssel → 403 (${viaKey.status})`,
    );
    const viaMallory = await mallory("/inspections/sign", {
      body: { ids: [readyId], signature: SIG },
    });
    check(
      viaMallory.status === 200 &&
        viaMallory.json.signed.length === 0 &&
        viaMallory.json.failed[0]?.id === readyId,
      "fremder Workspace unterschreibt nicht",
    );
    const viaInsp = await insp("/inspections/sign", {
      body: { ids: [readyId], signature: SIG },
    });
    check(
      viaInsp.json?.signed?.length === 0,
      "andere Person im Workspace unterschreibt nicht",
    );
    check(
      (
        await reader("/inspections/sign", {
          body: { ids: [readyId], signature: SIG },
        })
      ).status === 403,
      "Lesezugriff unterschreibt nicht",
    );
    check(
      (
        await owner("/inspections/sign", {
          body: { ids: [readyId], signature: "https://tracker.example/x.png" },
        })
      ).status === 400,
      "Unterschrift nur als Bild",
    );
    check(
      (await owner(`/inspections/${readyId}`)).json.status === "draft",
      "Entwurf bleibt unverändert",
    );
    check(
      !(await mallory("/inspections?status=ready")).json.some(
        (i) => i.id === readyId,
      ),
      "fremde bereite Prüfungen unsichtbar",
    );
    await owner(`/inspections/${readyId}`, { method: "DELETE" });
  }
  console.log("· #31 Autopilot-Hauptschalter und „Jetzt“ (GET /now)");
  check(
    (
      await reader("/automation/autopilot", {
        method: "PUT",
        body: { enabled: false },
      })
    ).status === 403,
    "Lesezugriff schaltet den Autopiloten nicht ab",
  );
  check(
    (
      await insp("/automation/autopilot", {
        method: "PUT",
        body: { enabled: false },
      })
    ).status === 403,
    "Prüfer schaltet den Autopiloten nicht ab",
  );
  check(
    (
      await owner("/automation/autopilot", {
        method: "PUT",
        body: { enabled: "nein" },
      })
    ).status === 400,
    "ungültiger Wert → 400",
  );
  check(
    (await owner("/automation/autopilot")).json.enabled === true,
    "Autopilot weiter an",
  );
  // Mallory schaltet nur den eigenen Workspace
  check(
    (
      await mallory("/automation/autopilot", {
        method: "PUT",
        body: { enabled: false },
      })
    ).status === 200,
    "Inhaberin des anderen Workspaces schaltet ihren",
  );
  check(
    (await owner("/automation/autopilot")).json.enabled === true &&
      (await mallory("/automation/autopilot")).json.enabled === false,
    "Schalter je Workspace",
  );
  // „Jetzt“ verrät nichts außerhalb des Bereichs und des Workspaces
  const outsideIds = [O.id, oAsset.id, oAsset.buildingId, oAsset.code];
  const inspNow = JSON.stringify((await insp("/now?limit=50")).json);
  check(
    !outsideIds.some((x) => x && inspNow.includes(x)) &&
      !inspNow.includes("Autopilot außen"),
    "eingeschränkter Prüfer: /now ohne fremde Objekte, Elemente, Mängel",
  );
  const inspSugg = JSON.stringify((await insp("/smart/suggestions")).json);
  check(
    !outsideIds.some((x) => x && inspSugg.includes(x)),
    "eingeschränkter Prüfer: /smart/suggestions ohne fremde Ziele",
  );
  const mNow = JSON.stringify((await mallory("/now?limit=50")).json);
  check(
    ![S.id, O.id, sAsset.id, oAsset.id].some((x) => mNow.includes(x)),
    "anderer Workspace: /now ohne fremde Daten",
  );
  check(
    (await reader("/now")).json.items.length === 0,
    "Lesezugriff: /now leer",
  );
  check(
    (await owner("/now?limit=99999")).json.items.length <= 50,
    "/now: limit gedeckelt",
  );

  console.log(
    "· #33 Objekte/Gebäude per Schlüssel einer Admin-/Inhaber-Person – sonst nichts Admin-Pflichtiges",
  );
  {
    const tool = async (k, name, args) => {
      const r = await fetch(BASE + "/api/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${k}`,
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }).then((x) => x.json());
      const text = r.result?.content?.[0]?.text ?? "";
      let data = null;
      try {
        data = r.result?.isError ? null : JSON.parse(text);
      } catch {
        /* kein JSON */
      }
      return { isError: r.result?.isError, text, data };
    };
    const withKey =
      (k) =>
      async (path, { method, body } = {}) => {
        const r = await fetch(BASE + "/api" + path, {
          method: method ?? (body !== undefined ? "POST" : "GET"),
          headers: {
            authorization: `Bearer ${k}`,
            ...(body !== undefined
              ? { "content-type": "application/json" }
              : {}),
          },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        });
        const text = await r.text();
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          /* kein JSON */
        }
        return { status: r.status, json };
      };
    // Neue Admin-Person mit eigenem Schreib- und Leseschlüssel
    const email = `admin33-${Date.now()}@example.com`;
    const invA = await owner("/account/members/invite", {
      body: { email, role: "admin" },
    });
    const adm = client();
    check(
      (
        await adm(`/auth/invite/${invA.json.token}`, {
          body: { name: "Admin 33", password: PW },
        })
      ).status === 200,
      "Admin-Person tritt bei",
    );
    const admId = (await owner("/account/members")).json.members.find(
      (m) => m.email === email,
    ).id;
    const admWrite = (
      await adm("/account/api-keys", {
        body: { name: "sec33-write", scope: "write", expiresInDays: 1 },
      })
    ).json;
    const admRead = (
      await adm("/account/api-keys", {
        body: { name: "sec33-read", scope: "read", expiresInDays: 1 },
      })
    ).json;
    const aw = withKey(admWrite.key);
    const ar = withKey(admRead.key);
    // Admins/Inhaber sind nie bereichseingeschränkt – der Zustand lässt sich gar nicht herstellen
    check(
      (
        await owner(`/account/members/${admId}/access`, {
          method: "PUT",
          body: {
            scope: { propertyIds: [S.id], buildingIds: [] },
            canCreate: true,
          },
        })
      ).status === 400,
      "Admin lässt sich nicht einschränken",
    );

    // Erlaubt: Objekt + Gebäude per Schreibschlüssel der Admin-Person
    const np = await aw("/properties", {
      body: { name: "Sec33 Objekt", address: "Teststraße 33" },
    });
    check(
      np.status === 200 && !!np.json?.id,
      `Schreibschlüssel (Admin) legt Objekt an (${np.status})`,
    );
    const nb = await aw(`/properties/${np.json?.id}/buildings`, {
      body: { name: "Sec33 Haus" },
    });
    check(
      nb.status === 200 && !!nb.json?.id,
      `Schreibschlüssel (Admin) legt Gebäude an (${nb.status})`,
    );
    const act = (await owner("/account/activity")).json;
    const actList = Array.isArray(act) ? act : (act?.items ?? []);
    check(
      actList.some(
        (e) => /Sec33 Objekt/.test(e.summary) && /sec33-write/.test(e.summary),
      ),
      "Protokoll nennt den Schlüssel",
    );
    // Fremde ID als Objekt: Gebäude nur im eigenen Workspace
    const mProp = (await mallory("/properties")).json[0];
    check(
      (
        await aw(`/properties/${mProp.id}/buildings`, {
          body: { name: "Sec33 fremd" },
        })
      ).status === 404,
      "Gebäude in fremdem Objekt → 404",
    );
    check(
      !JSON.stringify((await mallory(`/properties/${mProp.id}`)).json).includes(
        "Sec33",
      ),
      "anderer Workspace unberührt",
    );

    // Weiterhin verboten mit dem Schlüssel der Admin-Person
    check(
      (
        await aw(`/properties/${np.json.id}`, {
          method: "PATCH",
          body: { name: "Sec33 geändert" },
        })
      ).status === 403,
      "Schlüssel ändert kein Objekt",
    );
    check(
      (await aw(`/properties/${np.json.id}`, { method: "DELETE" })).status ===
        403,
      "Schlüssel löscht kein Objekt",
    );
    check(
      (
        await aw(`/buildings/${nb.json.id}`, {
          method: "PATCH",
          body: { name: "x" },
        })
      ).status === 403,
      "Schlüssel ändert kein Gebäude",
    );
    check(
      (await aw(`/buildings/${nb.json.id}`, { method: "DELETE" })).status ===
        403,
      "Schlüssel löscht kein Gebäude",
    );
    check(
      (
        await aw("/automation", {
          method: "PUT",
          body: { key: "plan_week", mode: "auto" },
        })
      ).status === 403,
      "Schlüssel setzt keine Autopilot-Stufe",
    );
    check(
      (
        await aw("/automation/autopilot", {
          method: "PUT",
          body: { enabled: false },
        })
      ).status === 403,
      "Schlüssel schaltet den Autopiloten nicht",
    );
    check(
      [401, 403].includes(
        (
          await aw(`/account/members/${admId}`, {
            method: "PATCH",
            body: { role: "owner" },
          })
        ).status,
      ),
      "Schlüssel ändert kein Team",
    );
    check(
      [401, 403].includes(
        (
          await aw("/account/members/invite", {
            body: { email: "x33@example.com", role: "admin" },
          })
        ).status,
      ),
      "Schlüssel lädt niemanden ein",
    );
    check(
      [401, 403].includes(
        (
          await aw("/account/api-keys", {
            body: { name: "neu", scope: "write" },
          })
        ).status,
      ),
      "Schlüssel erzeugt keine Schlüssel",
    );
    check(
      (await owner(`/properties/${np.json.id}`)).json.name === "Sec33 Objekt",
      "Objekt unverändert",
    );

    // Leseschlüssel der Admin-Person: nichts
    check(
      (await ar("/properties", { body: { name: "Sec33 lesend" } })).status ===
        403,
      "Leseschlüssel (Admin) legt kein Objekt an",
    );
    check(
      (
        await ar(`/properties/${np.json.id}/buildings`, {
          body: { name: "Sec33 lesend" },
        })
      ).status === 403,
      "Leseschlüssel (Admin) legt kein Gebäude an",
    );
    let t = await tool(admRead.key, "setup", {
      preview: false,
      property: { name: "Sec33 lesend" },
      buildings: [{ name: "L", elements: [{ category: "smoke_alarm" }] }],
    });
    check(
      t.isError === true &&
        !(await owner("/properties")).json.some(
          (p) => p.name === "Sec33 lesend",
        ),
      "setup mit Leseschlüssel legt nichts an",
    );

    // Herabgestuft zum Prüfer: Recht sofort weg (gleicher Schlüssel, ohne Neuanmeldung)
    check(
      (
        await owner(`/account/members/${admId}`, {
          method: "PATCH",
          body: { role: "inspector" },
        })
      ).status === 200,
      "Admin-Person zum Prüfer herabgestuft",
    );
    check(
      (await aw("/properties", { body: { name: "Sec33 Prüfer" } })).status ===
        403,
      "Schlüssel einer Prüfer-Person: Objekt → 403",
    );
    check(
      (
        await aw(`/properties/${np.json.id}/buildings`, {
          body: { name: "Sec33 Prüfer" },
        })
      ).status === 403,
      "Schlüssel einer Prüfer-Person: Gebäude → 403",
    );
    t = await tool(admWrite.key, "setup", {
      preview: true,
      property: { name: "Sec33 Prüfer" },
      buildings: [{ name: "P", elements: [{ category: "smoke_alarm" }] }],
    });
    check(
      t.data?.preview === true &&
        t.data.problems?.some((p) => /Admin- oder Inhaber-Person/.test(p)) &&
        !/wird neu angelegt/.test(t.text),
      `setup-Vorschau (Prüfer) nennt fehlendes Recht (${t.text.slice(0, 160)})`,
    );
    t = await tool(admWrite.key, "setup", {
      preview: false,
      property: { name: "Sec33 Prüfer" },
      buildings: [{ name: "P", elements: [{ category: "smoke_alarm" }] }],
    });
    check(
      t.isError === true && /Admin- oder Inhaber-Person/.test(t.text),
      `setup (Prüfer) bricht mit Hinweis ab (${t.text.slice(0, 120)})`,
    );
    t = await tool(admWrite.key, "setup", {
      preview: false,
      property: { name: "Sec33 Objekt" },
      buildings: [
        { name: "Sec33 Prüferhaus", elements: [{ category: "smoke_alarm" }] },
      ],
    });
    const after33 = (await owner(`/properties/${np.json.id}`)).json;
    check(
      !(await owner("/properties")).json.some(
        (p) => p.name === "Sec33 Prüfer",
      ) && !after33.buildings.some((b) => b.name === "Sec33 Prüferhaus"),
      "setup (Prüfer): nichts angelegt",
    );
    // Aufräumen (Admin-Sitzung)
    await owner(`/account/api-keys/${admWrite.id}`, { method: "DELETE" });
    await owner(`/account/api-keys/${admRead.id}`, { method: "DELETE" });
  }

  console.log(
    fail.length ? `FAILED ${fail.length}: ${fail.join("; ")}` : "ALL CHECKS OK",
  );
  if (fail.length) process.exitCode = 1;
})().catch((e) => {
  console.log("FAIL", e.stack);
  process.exit(1);
});

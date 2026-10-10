// PDF-Erzeugung im Browser (keine Server-Rechenzeit, funktioniert auch offline).
import { INSPECTION_KINDS, SEVERITIES } from '../../shared/catalog';
import { buildFileName, uniqueName } from '../../shared/filename';
import { BUILDING_TYPES, WALK_SECTIONS, type WalkSection } from '../../shared/walkthrough';
import { api, type Asset, type Defect, fileUrl, type Inspection, type Me, type PropertyDetail, type PropertyRow, type Walkthrough } from '../api';
import { getCategory } from '../categories';
import { RESULT_META } from '../format';
import { AMBER, type Brand, dataUrlBytes, Doc, GREEN, MUTED, RED } from './layout';

const dateFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dtFmt = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const d = (t: number | null | undefined) => (t ? dateFmt.format(t) : '–');
const dt = (t: number | null | undefined) => (t ? dtFmt.format(t) : '–');
const iso = (t: number | null | undefined) => (t ? new Date(t).toISOString().slice(0, 10) : '');
const ANSWER = { ok: 'i. O.', defect: 'Mangel', na: 'n. z.' } as const;
const resultColor = (r: string | null) => (r === 'ok' ? GREEN : r === 'critical' ? RED : r === 'defects' ? AMBER : MUTED);

async function fetchBytes(key: string | null | undefined): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!key) return null;
  try {
    const res = await fetch(key.startsWith('/') || key.startsWith('blob:') ? key : fileUrl(key), { credentials: 'same-origin' });
    if (!res.ok) return null;
    return { bytes: new Uint8Array(await res.arrayBuffer()), type: res.headers.get('content-type') ?? '' };
  } catch {
    return null;
  }
}

let brandCache: { key: string; brand: Brand } | null = null;
export async function loadBrand(me: Me): Promise<Brand> {
  const t = me.tenant;
  const cacheKey = JSON.stringify(t);
  if (brandCache?.key === cacheKey) return brandCache.brand;
  const logo = await fetchBytes(t.logoKey);
  const brand: Brand = {
    company: t.name,
    address: t.address,
    contact: [t.phone, t.email, t.website].filter(Boolean).join(' · '),
    logo: logo?.bytes,
    logoType: logo?.type,
    footer: `${t.name} · erstellt mit Prüfkompass am ${dt(Date.now())}`,
  };
  brandCache = { key: cacheKey, brand };
  return brand;
}

export function inspectionFileName(i: Inspection, tenantPattern: string) {
  return buildFileName(i.propertyPdfPattern || tenantPattern, {
    datum: iso(i.inspectedAt ?? i.createdAt),
    code: i.asset.code,
    art: i.asset.categoryLabel,
    pruefart: i.scheduleLabel,
    objekt: i.asset.propertyName,
    gebaeude: i.asset.buildingName,
    standort: i.asset.location,
    ergebnis: i.result ? RESULT_META[i.result].label : 'Entwurf',
  });
}

export async function inspectionPdf(i: Inspection, brand: Brand): Promise<Uint8Array> {
  const def = getCategory(i.asset.category);
  const doc = await Doc.create(brand, `Prüfprotokoll ${i.asset.code}`);
  doc.title(`Prüfprotokoll ${i.asset.categoryLabel}`, [i.scheduleLabel, i.asset.norm && `Grundlage: ${i.asset.norm}`].filter(Boolean).join(' · '), [
    i.asset.code,
    `Nr. ${i.id.slice(0, 8).toUpperCase()}`,
    ...(i.status === 'draft' ? ['ENTWURF'] : []),
  ]);
  const attrs = (def.attributes ?? []).map(({ key, label }) => {
    const v = i.asset.attributes[key];
    return [label, v === true ? 'Ja' : v === false ? 'Nein' : v == null || v === '' ? '–' : String(v)] as [string, string];
  });
  doc.facts([
    ['Objekt', i.asset.propertyName],
    ['Prüfdatum', dt(i.inspectedAt ?? i.createdAt)],
    ['Gebäude', i.asset.buildingName],
    ['Art der Prüfung', INSPECTION_KINDS[i.kind]],
    ['Standort', [i.asset.location, i.asset.floor].filter(Boolean).join(', ')],
    ['Prüfer/in', i.inspectorName],
    ['Hersteller / Typ', [i.asset.manufacturer, i.asset.model].filter(Boolean).join(' / ')],
    ['Nächste Prüfung', d(i.nextDueAt)],
    ...attrs,
  ]);

  doc.heading('Prüfpunkte');
  if (i.notInspectable) doc.text('Das Element war zum Prüfzeitpunkt nicht prüfbar.', { color: MUTED });
  else
    doc.table(
      [
        { label: 'Nr.', w: 0.6 },
        { label: 'Prüfpunkt', w: 8 },
        { label: 'Befund', w: 1.4, align: 'right' },
      ],
      i.checkpoints.map((cp, n) => {
        const a = i.answers[cp.id];
        return { cells: [String(n + 1), cp.label, a ? ANSWER[a] : '–'], color: [undefined, undefined, a === 'defect' ? RED : undefined] };
      }),
    );

  if (i.defects.length) {
    doc.heading('Festgestellte Mängel');
    for (const [n, df] of i.defects.entries()) {
      doc.text(`${n + 1}. ${df.title} – ${SEVERITIES[df.severity]}`, { bold: true });
      if (df.note) doc.text(df.note, { color: MUTED, x: 58, width: doc.width - 12 });
      const img = await fetchBytes(df.photoKey);
      if (img) await doc.image(img.bytes, img.type, 200, 130);
      doc.gap(4);
    }
  }
  if (i.maintenance.length) {
    doc.heading('Durchgeführte Arbeiten');
    doc.text(i.maintenance.map((k) => def.maintenance.find((m) => m.key === k)?.label ?? k).join(' · '));
  }
  if (i.notes) {
    doc.heading('Bemerkungen');
    doc.text(i.notes);
  }
  if (i.photos?.length) {
    doc.heading('Fotos');
    const items = [];
    for (const p of i.photos) {
      const b = await fetchBytes(p.key);
      items.push({ bytes: b?.bytes ?? null, type: b?.type ?? '', caption: p.caption });
    }
    await doc.gallery(items);
  }
  const sig = dataUrlBytes(i.signature);
  await doc.resultAndSignature('Gesamtergebnis', i.result ? RESULT_META[i.result].label : 'Offen', resultColor(i.result), {
    bytes: sig?.bytes ?? null,
    type: sig?.type ?? '',
    name: i.signerName || i.inspectorName,
    date: d(i.inspectedAt ?? i.createdAt),
  });
  return doc.finish();
}

export async function walkthroughPdf(w: Walkthrough, brand: Brand): Promise<Uint8Array> {
  const doc = await Doc.create(brand, `Begehung ${w.propertyName}`);
  doc.title('Protokoll Brandschutzbegehung', [w.propertyName, w.buildingName].filter(Boolean).join(' · '), [dt(w.inspectedAt ?? w.createdAt), ...(w.status === 'draft' ? ['ENTWURF'] : [])]);
  doc.facts([
    ['Adresse', w.propertyAddress.split('\n').join(', ')],
    ['Nutzung', BUILDING_TYPES[w.buildingType]],
    ['Durchgeführt von', w.inspectorName],
    ['Nächste Begehung', d(w.nextDueAt)],
    ['Teilnehmende', w.participants],
    ['Feststellungen', String(w.findings.length)],
  ]);
  if (w.findings.length) {
    doc.heading('Feststellungen');
    for (const [n, f] of w.findings.entries()) {
      const q = w.questions.find((x) => x.id === f.questionId);
      doc.text(`${n + 1}. ${f.title} – ${SEVERITIES[f.severity]}${q ? ` (${q.basis})` : ''}`, { bold: true });
      if (f.note) doc.text(f.note, { color: MUTED, x: 58, width: doc.width - 12 });
      const img = await fetchBytes(f.photoKey);
      if (img) await doc.image(img.bytes, img.type, 200, 130);
      doc.gap(4);
    }
  }
  for (const sec of [...new Set(w.questions.map((q) => q.section as WalkSection))]) {
    doc.heading(WALK_SECTIONS[sec], 11);
    doc.table(
      [
        { label: 'Frage', w: 6 },
        { label: 'Grundlage', w: 2.4 },
        { label: 'Befund', w: 1.2, align: 'right' },
      ],
      w.questions
        .filter((q) => q.section === sec)
        .map((q) => {
          const a = w.answers[q.id];
          return { cells: [q.text, q.basis, a ? ANSWER[a] : '–'], color: [undefined, undefined, a === 'defect' ? RED : undefined] };
        }),
    );
  }
  if (w.notes) {
    doc.heading('Bemerkungen');
    doc.text(w.notes);
  }
  const sig = dataUrlBytes(w.signature);
  await doc.resultAndSignature('Gesamtergebnis', w.result ? RESULT_META[w.result].label : 'Offen', resultColor(w.result), {
    bytes: sig?.bytes ?? null,
    type: sig?.type ?? '',
    name: w.signerName || w.inspectorName,
    date: d(w.inspectedAt ?? w.createdAt),
  });
  doc.gap(6);
  doc.text('Rechtsgrundlagen sind Orientierungshinweise; maßgeblich sind die im Einzelfall geltenden Vorschriften und das Brandschutzkonzept.', { size: 7.5, color: MUTED });
  return doc.finish();
}

export async function defectsPdf(defects: Defect[], brand: Brand): Promise<Uint8Array> {
  const doc = await Doc.create(brand, 'Mängelbericht');
  doc.title('Mängelbericht', `${defects.length} offene Mängel · Stand ${dt(Date.now())}`);
  for (const [n, df] of defects.entries()) {
    doc.ensure(40);
    doc.text(`${n + 1}. ${df.title}`, { bold: true });
    doc.text(
      [SEVERITIES[df.severity], df.code ?? 'Begehung', df.location, df.buildingName, df.propertyName, `erfasst ${d(df.createdAt)}`, df.legalBasis].filter(Boolean).join(' · '),
      { size: 8.5, color: df.severity === 'critical' || df.severity === 'high' ? RED : MUTED },
    );
    if (df.note) doc.text(df.note, { size: 9 });
    const img = await fetchBytes(df.photoKey);
    if (img) await doc.image(img.bytes, img.type, 180, 110);
    doc.gap(6);
  }
  if (!defects.length) doc.text('Keine offenen Mängel.', { color: MUTED });
  return doc.finish();
}

export async function compliancePdf(props: PropertyRow[], overdue: Asset[], soon: Asset[], brand: Brand): Promise<Uint8Array> {
  const doc = await Doc.create(brand, 'Compliance-Übersicht');
  const total = props.reduce((s, p) => s + p.assets, 0);
  doc.title('Compliance-Übersicht', `${props.length} Objekte · ${total} Elemente · Stand ${dt(Date.now())}`);
  doc.table(
    [
      { label: 'Objekt', w: 4 },
      { label: 'Elemente', w: 1.1, align: 'right' },
      { label: 'Überfällig', w: 1.2, align: 'right' },
      { label: 'Bald fällig', w: 1.2, align: 'right' },
      { label: 'Ungeprüft', w: 1.2, align: 'right' },
      { label: 'Mängel', w: 1, align: 'right' },
      { label: 'Begehung', w: 1.6, align: 'right' },
    ],
    props.map((p) => ({
      cells: [p.name, String(p.assets), String(p.overdue ?? 0), String(p.soon ?? 0), String(p.never ?? 0), String(p.openDefects), d(p.nextWalkAt)],
      color: [undefined, undefined, p.overdue ? RED : undefined],
    })),
  );
  for (const [title, list] of [
    ['Überfällige Elemente', overdue],
    ['In 30 Tagen fällig', soon],
  ] as const) {
    doc.heading(`${title} (${list.length})`);
    if (!list.length) doc.text('Keine.', { color: MUTED });
    else
      doc.table(
        [
          { label: 'Code', w: 1.6 },
          { label: 'Art', w: 2 },
          { label: 'Ort', w: 5 },
          { label: 'Fällig', w: 1.4, align: 'right' },
        ],
        list.map((a) => ({ cells: [a.code, getCategory(a.category).label, [a.propertyName, a.buildingName, a.location].filter(Boolean).join(' · '), d(a.nextDueAt)] })),
      );
  }
  return doc.finish();
}

/** Objektbericht: Stammdaten, Brandschutzbeauftragte, Status je Gebäude, alle Elemente, offene Mängel, Begehungen. */
export async function propertyPdf(p: PropertyDetail, defects: Defect[], brand: Brand): Promise<Uint8Array> {
  const now = Date.now();
  const soon = now + 30 * 86_400_000;
  const doc = await Doc.create(brand, `Objektbericht ${p.name}`);
  const overdue = p.assets.filter((a) => a.nextDueAt != null && a.nextDueAt < now);
  const dueSoon = p.assets.filter((a) => a.nextDueAt != null && a.nextDueAt >= now && a.nextDueAt <= soon);
  const never = p.assets.filter((a) => a.nextDueAt == null);
  doc.title(`Objektbericht ${p.name}`, [p.address, `Stand ${dt(now)}`].filter(Boolean).join(' · '));
  const officer = p.fireOfficers.find((o) => !o.appointedTo || o.appointedTo > now);
  doc.facts([
    ['Nutzung', BUILDING_TYPES[p.buildingType] ?? '–'],
    ['Ansprechpartner', [p.contactName, p.contactPhone, p.contactEmail].filter(Boolean).join(' · ') || '–'],
    ['Brandschutzbeauftragte/r', officer ? [officer.name, officer.company, officer.phone].filter(Boolean).join(' · ') : '–'],
    ['Elemente', `${p.assets.length} in ${p.buildings.length} Gebäuden`],
    ['Status', `${overdue.length} überfällig · ${dueSoon.length} in 30 Tagen fällig · ${never.length} ungeprüft · ${defects.length} offene Mängel`],
  ]);
  if (p.description) doc.text(p.description, { size: 9, color: MUTED });

  doc.heading('Status je Gebäude');
  doc.table(
    [
      { label: 'Gebäude', w: 4 },
      { label: 'Elemente', w: 1.2, align: 'right' },
      { label: 'Überfällig', w: 1.2, align: 'right' },
      { label: 'Bald fällig', w: 1.2, align: 'right' },
      { label: 'Ungeprüft', w: 1.2, align: 'right' },
      { label: 'Mängel', w: 1, align: 'right' },
    ],
    p.buildings.map((b) => {
      const list = p.assets.filter((a) => a.buildingId === b.id);
      const o = list.filter((a) => overdue.includes(a)).length;
      return {
        cells: [b.name, String(list.length), String(o), String(list.filter((a) => dueSoon.includes(a)).length), String(list.filter((a) => never.includes(a)).length), String(list.reduce((n, a) => n + (a.openDefects ?? 0), 0))],
        color: [undefined, undefined, o ? RED : undefined],
      };
    }),
  );

  for (const b of p.buildings) {
    const list = p.assets.filter((a) => a.buildingId === b.id);
    doc.heading(`Elemente · ${b.name} (${list.length})`);
    if (!list.length) {
      doc.text('Keine Elemente.', { color: MUTED });
      continue;
    }
    doc.table(
      [
        { label: 'Code', w: 1.5 },
        { label: 'Art', w: 2 },
        { label: 'Standort', w: 3.4 },
        { label: 'Letzte Prüfung', w: 1.5 },
        { label: 'Ergebnis', w: 1.5 },
        { label: 'Nächste', w: 1.4, align: 'right' },
      ],
      list.map((a) => ({
        cells: [a.code, getCategory(a.category).label, [a.location, a.floor].filter(Boolean).join(' · '), d(a.lastInspectedAt), a.lastResult ? RESULT_META[a.lastResult].label : '–', d(a.nextDueAt)],
        color: [undefined, undefined, undefined, undefined, resultColor(a.lastResult), a.nextDueAt != null && a.nextDueAt < now ? RED : undefined],
      })),
    );
  }

  doc.heading(`Offene Mängel (${defects.length})`);
  if (!defects.length) doc.text('Keine offenen Mängel.', { color: MUTED });
  for (const df of defects) {
    doc.ensure(30);
    doc.text(df.title, { bold: true, size: 9.5 });
    doc.text([SEVERITIES[df.severity], df.code ?? 'Begehung', df.location, df.buildingName, `erfasst ${d(df.createdAt)}`].filter(Boolean).join(' · '), {
      size: 8.5,
      color: df.severity === 'critical' || df.severity === 'high' ? RED : MUTED,
    });
    if (df.note) doc.text(df.note, { size: 9 });
    doc.gap(4);
  }

  const walks = p.walkthroughs.filter((w) => w.status === 'submitted');
  doc.heading('Brandschutzbegehungen');
  if (!walks.length) doc.text('Noch keine Begehung abgeschlossen.', { color: MUTED });
  else
    doc.table(
      [
        { label: 'Datum', w: 1.6 },
        { label: 'Durchgeführt von', w: 3 },
        { label: 'Ergebnis', w: 1.8 },
        { label: 'Offene Mängel', w: 1.6, align: 'right' },
        { label: 'Nächste', w: 1.6, align: 'right' },
      ],
      walks.map((w) => ({ cells: [d(w.inspectedAt), w.inspector, w.result ? RESULT_META[w.result].label : '–', String(w.openDefects), d(w.nextDueAt)], color: [undefined, undefined, resultColor(w.result)] })),
    );
  return doc.finish();
}

export function download(bytes: Uint8Array | Blob, name: string, type = 'application/pdf') {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes as BlobPart], { type });
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Mehrere Prüfprotokolle als ZIP. */
export async function protocolsZip(ids: string[], me: Me, onProgress?: (done: number, total: number) => void): Promise<Uint8Array> {
  const { zipSync } = await import('fflate');
  const brand = await loadBrand(me);
  const files: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const [n, id] of ids.entries()) {
    const insp = await api<Inspection>(`/inspections/${id}`);
    files[uniqueName(inspectionFileName(insp, me.tenant.pdfPattern), used)] = await inspectionPdf(insp, brand);
    onProgress?.(n + 1, ids.length);
  }
  return zipSync(files, { level: 0 });
}



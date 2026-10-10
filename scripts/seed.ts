/**
 * Erzeugt einen Demo-Workspace als SQL (+ SVG-Grundrisse für R2).
 *   DEMO_PASSWORD=… npx vite-node scripts/seed.ts -- <ausgabe-ordner>
 *   wrangler d1 execute DB --remote --file <ausgabe-ordner>/seed.sql
 *   wrangler r2 object put pruefkompass-files/<key> --file <datei> --content-type image/svg+xml --remote
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATEGORIES, type Category } from '../shared/catalog';
import { addMonths } from '../shared/logic';
import { type BuildingType, questionsFor } from '../shared/walkthrough';

const out = process.argv.slice(2).filter((a) => a !== '--')[0] ?? 'seed-out';
const password = process.env.DEMO_PASSWORD;
if (!password || password.length < 10) throw new Error('DEMO_PASSWORD (min. 10 Zeichen) setzen');
mkdirSync(join(out, 'plans'), { recursive: true });

// ---------- deterministischer Zufall ----------
let s = 20261010;
const rnd = () => ((s = (s * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
const between = (a: number, b: number) => a + rnd() * (b - a);
const alpha = 'abcdefghijkmnopqrstuvwxyz23456789';
const id = () => Array.from({ length: 16 }, () => alpha[Math.floor(rnd() * alpha.length)]).join('');
const CODEA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const usedCodes = new Set<string>();
const code = (cat: Category) => {
  for (;;) {
    const c = `${CATEGORIES[cat].prefix}-${Array.from({ length: 4 }, () => CODEA[Math.floor(rnd() * CODEA.length)]).join('')}`;
    if (!usedCodes.has(c)) return usedCodes.add(c), c;
  }
};

const DAY = 86_400_000;
const NOW = Date.now();
const sql: string[] = [];
const q = (v: unknown) => (v == null ? 'NULL' : typeof v === 'number' ? String(Math.abs(v) >= 1000 ? Math.round(v) : v) : typeof v === 'boolean' ? (v ? '1' : '0') : `'${String(v).replace(/'/g, "''")}'`);
const insert = (table: string, row: Record<string, unknown>) => sql.push(`INSERT INTO ${table} (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(q).join(',')});`);

async function hash(pw: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
  const b64 = (b: ArrayBuffer | Uint8Array) => Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString('base64');
  return `pbkdf2$100000$${b64(salt)}$${b64(bits)}`;
}

const signature = (name: string) => {
  const [a, b] = name.split(' ');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="100"><path d="M10 70 C 40 10, 60 90, 90 40 S 130 80, 150 50" fill="none" stroke="#1c1917" stroke-width="2.5" stroke-linecap="round"/><text x="160" y="62" font-family="cursive, serif" font-size="30" fill="#1c1917">${a[0]}. ${b}</text></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};

// ---------- Workspace & Personen ----------
const tenantId = id();
insert('tenants', { id: tenantId, name: 'Nordlicht Facility Services GmbH', created_at: NOW - 800 * DAY });
const pwHash = await hash(password);
const people = {
  owner: { id: id(), email: 'demo@example.com', name: 'Sabine Krüger', role: 'owner' },
  inspector: { id: id(), email: 'pruefer@example.com', name: 'Jonas Weber', role: 'inspector' },
  inspector2: { id: id(), email: 'pruefer2@example.com', name: 'Aylin Demir', role: 'inspector' },
  viewer: { id: id(), email: 'lesen@example.com', name: 'Hausverwaltung Lesezugriff', role: 'viewer' },
};
for (const p of Object.values(people)) {
  insert('users', { id: p.id, email: p.email, name: p.name, password_hash: pwHash, created_at: NOW - 700 * DAY });
  insert('memberships', { tenant_id: tenantId, user_id: p.id, role: p.role, created_at: NOW - 700 * DAY });
}
const inspectors = [people.inspector, people.inspector2, people.owner];

const subs = [
  { company: 'Türtechnik Hansen KG', trade: 'Feuerschutztüren & Feststellanlagen', contact_name: 'Peter Hansen', phone: '040 555 0101', email: 'service@example.org' },
  { company: 'Lüftung & Klappen Nord GmbH', trade: 'Brandschutzklappen / RLT', contact_name: 'Mira Koch', phone: '040 555 0202', email: 'dispo@example.org' },
  { company: 'FireCheck Löschtechnik', trade: 'Feuerlöscher & Wandhydranten', contact_name: 'Tim Brandt', phone: '040 555 0303', email: 'info@example.org' },
].map((x) => ({ id: id(), ...x }));
for (const x of subs) insert('subcontractors', { id: x.id, tenant_id: tenantId, notes: '', created_at: NOW - 400 * DAY, ...x });
const subFor: Record<Category, string> = { fire_door: subs[0].id, damper: subs[1].id, extinguisher: subs[2].id, smoke_alarm: subs[2].id };

// ---------- Grundriss-SVG ----------
type Room = [number, number, number, number, string];
function planSvg(title: string, rooms: Room[]) {
  const W = 1600;
  const H = 1000;
  const r = rooms
    .map(
      ([x, y, w, h, label]) =>
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#44403c" stroke-width="6"/><text x="${x + w / 2}" y="${y + h / 2}" font-family="Helvetica, Arial" font-size="26" fill="#78716c" text-anchor="middle" dominant-baseline="middle">${label}</text>`,
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#fafaf9"/><rect x="40" y="40" width="${W - 80}" height="${H - 80}" fill="#f5f5f4" stroke="#1c1917" stroke-width="12"/>${r}<text x="70" y="${H - 60}" font-family="Helvetica, Arial" font-size="28" font-weight="bold" fill="#1c1917">${title}</text><g transform="translate(${W - 140},${H - 140})"><circle r="40" fill="none" stroke="#1c1917" stroke-width="3"/><path d="M0 -34 L10 0 L0 -8 L-10 0Z" fill="#1c1917"/><text y="-48" text-anchor="middle" font-family="Helvetica" font-size="22">N</text></g></svg>`;
}
const schoolEG: Room[] = [
  [60, 60, 360, 300, 'Klasse 1a'],
  [420, 60, 360, 300, 'Klasse 1b'],
  [780, 60, 300, 300, 'Lehrerzimmer'],
  [1080, 60, 460, 300, 'Mensa'],
  [60, 360, 200, 280, 'Treppe West'],
  [1340, 360, 200, 280, 'Treppe Ost'],
  [60, 640, 420, 300, 'Klasse 2a'],
  [480, 640, 360, 300, 'Werkraum'],
  [840, 640, 300, 300, 'Technik'],
  [1140, 640, 400, 300, 'Küche'],
];
const schoolOG: Room[] = [
  [60, 60, 480, 300, 'Klasse 3a'],
  [540, 60, 480, 300, 'Klasse 3b'],
  [1020, 60, 520, 300, 'Bibliothek'],
  [60, 360, 200, 280, 'Treppe West'],
  [1340, 360, 200, 280, 'Treppe Ost'],
  [60, 640, 480, 300, 'Klasse 4a'],
  [540, 640, 480, 300, 'Klasse 4b'],
  [1020, 640, 520, 300, 'Musikraum'],
];
const careEG: Room[] = [
  [60, 60, 300, 280, 'Zimmer 101'],
  [360, 60, 300, 280, 'Zimmer 102'],
  [660, 60, 300, 280, 'Zimmer 103'],
  [960, 60, 580, 280, 'Speisesaal'],
  [60, 340, 220, 320, 'Treppenhaus'],
  [1300, 340, 240, 320, 'Pflegestützpunkt'],
  [60, 660, 400, 280, 'Zimmer 104'],
  [460, 660, 400, 280, 'Zimmer 105'],
  [860, 660, 300, 280, 'Wäscherei'],
  [1160, 660, 380, 280, 'Haustechnik'],
];

// ---------- Objekte, Gebäude, Elemente ----------
interface AssetSpec {
  cat: Category;
  location: string;
  floor: string;
  pos?: [number, number];
}
interface BuildingSpec {
  name: string;
  plans?: { name: string; level: number; rooms: Room[]; floor: string }[];
  assets: AssetSpec[];
}
interface PropertySpec {
  name: string;
  address: string;
  type: BuildingType;
  contact: [string, string, string];
  description: string;
  buildings: BuildingSpec[];
}

const doors = (floor: string, list: [string, number, number][]): AssetSpec[] => list.map(([l, x, y]) => ({ cat: 'fire_door', location: l, floor, pos: [x, y] }));
const at = (cat: Category, floor: string, list: [string, number, number][]): AssetSpec[] => list.map(([l, x, y]) => ({ cat, location: l, floor, pos: [x, y] }));
const plain = (cat: Category, floor: string, list: string[]): AssetSpec[] => list.map((l) => ({ cat, location: l, floor }));

const properties: PropertySpec[] = [
  {
    name: 'Grundschule Am Stadtpark',
    address: 'Parkallee 12\n22301 Hamburg',
    type: 'school',
    contact: ['Herr Petersen (Hausmeister)', '040 555 1201', 'hausmeister@example.net'],
    description: 'Schlüssel beim Hausmeister, Zugang Technikraum nur mit Begleitung. Prüfungen möglichst in den Ferien.',
    buildings: [
      {
        name: 'Haupthaus',
        plans: [
          { name: 'Erdgeschoss', level: 0, rooms: schoolEG, floor: 'EG' },
          { name: '1. Obergeschoss', level: 1, rooms: schoolOG, floor: '1. OG' },
        ],
        assets: [
          ...doors('EG', [
            ['Treppenhaus West, Flurseite', 0.165, 0.37],
            ['Treppenhaus Ost, Flurseite', 0.835, 0.37],
            ['Zugang Technikraum', 0.615, 0.64],
            ['Küche / Mensa', 0.78, 0.64],
            ['Flurabschluss Mitte', 0.5, 0.5],
          ]),
          ...at('extinguisher', 'EG', [
            ['Flur bei Klasse 1b', 0.36, 0.385],
            ['Küche', 0.86, 0.85],
            ['Werkraum', 0.37, 0.85],
          ]),
          ...at('smoke_alarm', 'EG', [
            ['Lehrerzimmer', 0.58, 0.2],
            ['Werkraum', 0.42, 0.78],
          ]),
          ...at('damper', 'EG', [
            ['Technikraum, Zuluft', 0.56, 0.8],
            ['Küche, Abluft', 0.8, 0.8],
          ]),
          ...doors('1. OG', [
            ['Treppenhaus West, OG', 0.165, 0.37],
            ['Treppenhaus Ost, OG', 0.835, 0.37],
          ]),
          ...at('extinguisher', '1. OG', [['Flur vor Bibliothek', 0.7, 0.385]]),
          ...at('smoke_alarm', '1. OG', [
            ['Bibliothek', 0.8, 0.2],
            ['Musikraum', 0.8, 0.8],
          ]),
        ],
      },
      {
        name: 'Sporthalle',
        assets: [
          ...plain('fire_door', 'EG', ['Halle → Geräteraum', 'Umkleide Nord', 'Notausgang Süd']),
          ...plain('extinguisher', 'EG', ['Geräteraum', 'Eingangsbereich']),
          ...plain('smoke_alarm', 'EG', ['Hausmeisterraum']),
        ],
      },
    ],
  },
  {
    name: 'Seniorenresidenz Elbblick',
    address: 'Elbchaussee 230\n22605 Hamburg',
    type: 'care',
    contact: ['Frau Lorenz (Einrichtungsleitung)', '040 555 2300', 'leitung@example.net'],
    description: 'Prüfungen nur werktags 9–15 Uhr. Bewohnerzimmer nur nach Absprache mit dem Pflegestützpunkt betreten.',
    buildings: [
      {
        name: 'Haus A',
        plans: [{ name: 'Erdgeschoss Haus A', level: 0, rooms: careEG, floor: 'EG' }],
        assets: [
          ...doors('EG', [
            ['Treppenhaus, Flur', 0.18, 0.5],
            ['Stationstür Ost', 0.81, 0.5],
            ['Speisesaal', 0.6, 0.34],
            ['Haustechnik', 0.82, 0.66],
            ['Wäscherei', 0.63, 0.66],
          ]),
          ...at('smoke_alarm', 'EG', [
            ['Zimmer 101', 0.13, 0.2],
            ['Zimmer 102', 0.32, 0.2],
            ['Zimmer 103', 0.5, 0.2],
            ['Zimmer 104', 0.16, 0.8],
            ['Zimmer 105', 0.41, 0.8],
          ]),
          ...at('extinguisher', 'EG', [
            ['Pflegestützpunkt', 0.88, 0.5],
            ['Wäscherei', 0.63, 0.82],
          ]),
          ...at('damper', 'EG', [
            ['Haustechnik, Abluft Wäscherei', 0.84, 0.82],
            ['Speisesaal, Zuluft', 0.78, 0.2],
          ]),
        ],
      },
      {
        name: 'Haus B',
        assets: [
          ...plain('fire_door', '1. OG', ['Treppenhaus B', 'Stationstür Nord', 'Aufenthaltsraum']),
          ...plain('smoke_alarm', '1. OG', ['Zimmer 201', 'Zimmer 202', 'Zimmer 203', 'Zimmer 204']),
          ...plain('extinguisher', '1. OG', ['Flur Mitte']),
        ],
      },
    ],
  },
  {
    name: 'Verwaltungsgebäude Hafenstraße',
    address: 'Hafenstraße 8\n20359 Hamburg',
    type: 'general',
    contact: ['Herr Yilmaz (Facility Management)', '040 555 0808', 'fm@example.net'],
    description: 'Anmeldung am Empfang. Serverraum mit Gaslöschanlage – nur mit IT betreten.',
    buildings: [
      {
        name: 'Bürogebäude',
        assets: [
          ...plain('fire_door', 'EG', ['Foyer → Treppenhaus 1', 'Tiefgaragenzugang']),
          ...plain('fire_door', '2. OG', ['Treppenhaus 1, 2. OG', 'Treppenhaus 2, 2. OG', 'Serverraum']),
          ...plain('damper', 'UG', ['Technikzentrale, Zuluft 1', 'Technikzentrale, Zuluft 2', 'Technikzentrale, Abluft', 'Serverraum']),
          ...plain('extinguisher', 'EG', ['Empfang', 'Teeküche EG']),
          ...plain('extinguisher', '2. OG', ['Teeküche 2. OG', 'Kopierraum']),
        ],
      },
    ],
  },
  {
    name: 'Logistikzentrum Nord',
    address: 'Am Güterbahnhof 41\n21079 Hamburg',
    type: 'warehouse',
    contact: ['Frau Schulte (Standortleitung)', '040 555 4141', 'standort@example.net'],
    description: 'Sicherheitsunterweisung am Tor 1 vor Betreten der Halle. Sprinklerzentrale im Nebengebäude.',
    buildings: [
      {
        name: 'Halle 1',
        assets: [
          ...plain('fire_door', 'EG', ['Brandwand Achse 5', 'Brandwand Achse 12', 'Zugang Büro', 'Ladezone Akku']),
          ...plain('extinguisher', 'EG', ['Tor 1', 'Tor 4', 'Ladezone Stapler', 'Kommissionierung A', 'Kommissionierung B', 'Werkstatt']),
        ],
      },
      { name: 'Bürotrakt', assets: [...plain('fire_door', '1. OG', ['Treppenhaus Büro']), ...plain('smoke_alarm', '1. OG', ['Pausenraum', 'Erste Hilfe'])] },
    ],
  },
];

// Szenarien: Anteil ok / bald fällig / überfällig / nie / nicht prüfbar
type Scenario = 'ok' | 'soon' | 'overdue' | 'never' | 'not_inspectable';
const scenario = (): Scenario => {
  const r = rnd();
  return r < 0.62 ? 'ok' : r < 0.74 ? 'soon' : r < 0.86 ? 'overdue' : r < 0.96 ? 'never' : 'not_inspectable';
};
const DEFECT_NOTES = ['Austausch erforderlich', 'Nachstellen durch Fachfirma', 'Betreiber informiert', 'Provisorisch gesichert', ''];

const r2: { key: string; file: string }[] = [];
let assetCount = 0;
let labelCount = 0;
const openDefectRows: { id: string; assetId: string; cat: Category; title: string; severity: string; propertyId: string }[] = [];

for (const ps of properties) {
  const propertyId = id();
  insert('properties', {
    id: propertyId,
    tenant_id: tenantId,
    name: ps.name,
    address: ps.address,
    description: ps.description,
    contact_name: ps.contact[0],
    contact_phone: ps.contact[1],
    contact_email: ps.contact[2],
    building_type: ps.type,
    created_at: NOW - 720 * DAY,
    updated_at: NOW - 30 * DAY,
  });
  (ps as PropertySpec & { id: string }).id = propertyId;

  for (const bs of ps.buildings) {
    const buildingId = id();
    insert('buildings', { id: buildingId, tenant_id: tenantId, property_id: propertyId, name: bs.name, address: '', created_at: NOW - 720 * DAY, updated_at: NOW - 720 * DAY });
    const planByFloor = new Map<string, string>();
    for (const pl of bs.plans ?? []) {
      const planId = id();
      const key = `${tenantId}/plan-${planId}`;
      const file = join(out, 'plans', `${planId}.svg`);
      writeFileSync(file, planSvg(`${ps.name} · ${bs.name} · ${pl.name}`, pl.rooms));
      r2.push({ key, file });
      insert('floor_plans', { id: planId, tenant_id: tenantId, building_id: buildingId, name: pl.name, level: pl.level, file_key: key, width: 1600, height: 1000, created_at: NOW - 300 * DAY });
      planByFloor.set(pl.floor, planId);
    }

    for (const a of bs.assets) {
      assetCount++;
      const def = CATEGORIES[a.cat];
      const assetId = id();
      const c = code(a.cat);
      const sc = scenario();
      const interval = def.intervalMonths;
      const year = Math.floor(between(1998, 2022));
      const attrs: Record<string, unknown> =
        a.cat === 'fire_door'
          ? { year, rating: pick(['T30', 'T30', 'T90', 'EI2 30']), smoke: rnd() < 0.7, leaves: pick(['1-flügelig', '1-flügelig', '2-flügelig']), holdOpen: rnd() < 0.3, approval: `Z-6.20-${Math.floor(between(1000, 2999))}` }
          : a.cat === 'damper'
            ? { year, damperNo: `BSK-${Math.floor(between(10, 99))}`, rating: pick(['K90', 'EI 90 S']), actuator: pick(['Mechanisch', 'Federrücklaufmotor']), size: pick(['200 x 200', '400 x 300', 'DN 250']) }
            : a.cat === 'extinguisher'
              ? { year: Math.floor(between(2014, 2024)), serial: `FL${Math.floor(between(100000, 999999))}`, agent: pick(['ABC-Pulver', 'Schaum', 'Schaum', 'CO₂']), size: pick([6, 6, 9, 5]), classes: 'A, B' }
              : { manufactured: `${Math.floor(between(2016, 2024))}-0${Math.floor(between(1, 9))}-01`, serial: `RM${Math.floor(between(100000, 999999))}`, battery: '10-Jahres-Lithium' };
      const manufacturer =
        a.cat === 'fire_door' ? pick(['Hörmann', 'Teckentrup', 'Schörghuber', 'Novoferm']) : a.cat === 'damper' ? pick(['Trox', 'Wildeboer', 'Schako']) : a.cat === 'extinguisher' ? pick(['Gloria', 'Minimax', 'Jockel']) : pick(['Ei Electronics', 'Hekatron', 'Busch-Jaeger']);
      const planId = a.pos ? planByFloor.get(a.floor) : undefined;
      const label = rnd() < 0.25 ? `PK-${Array.from({ length: 6 }, () => CODEA[Math.floor(rnd() * CODEA.length)]).join('')}` : null;
      if (label) labelCount++;

      // Prüfhistorie
      const intervalDays = interval * 30.4 * DAY; // in ms
      const lastAt =
        sc === 'ok'
          ? NOW - between(0.08, 0.85) * intervalDays
          : sc === 'soon'
            ? NOW - intervalDays + between(5, 25) * DAY
            : sc === 'overdue'
              ? NOW - intervalDays - between(10, 140) * DAY
              : sc === 'not_inspectable'
                ? NOW - between(10, 60) * DAY
                : null;
      let lastId: string | null = null;
      let lastResult: string | null = null;
      let nextDue: number | null = null;

      const assetSqlAt = sql.length; // Element muss vor seinen Prüfungen stehen (Fremdschlüssel)
      const history: number[] = [];
      if (lastAt) {
        if (rnd() < 0.6) history.push(lastAt - intervalDays - between(-10, 20) * DAY);
        history.push(lastAt);
      }
      for (const [hi, t] of history.entries()) {
        const isLast = hi === history.length - 1;
        const notInsp = isLast && sc === 'not_inspectable';
        const answers: Record<string, string> = {};
        const defects: { checkpointId: string; title: string; note: string; severity: string }[] = [];
        const defectCount = notInsp ? 0 : rnd() < 0.22 ? (rnd() < 0.7 ? 1 : 2) : 0;
        const defectIdx = new Set(Array.from({ length: defectCount }, () => Math.floor(rnd() * def.checkpoints.length)));
        def.checkpoints.forEach((cp, i) => {
          if (notInsp) return;
          if (defectIdx.has(i)) {
            answers[cp.id] = 'defect';
            defects.push({ checkpointId: cp.id, title: cp.label, note: pick(DEFECT_NOTES), severity: pick(['low', 'medium', 'medium', 'high', 'critical']) });
          } else answers[cp.id] = cp.hint?.includes('wenn vorhanden') && !attrs.holdOpen ? 'na' : 'ok';
        });
        if (a.cat === 'fire_door' && !attrs.holdOpen && !notInsp) {
          answers.p12 = answers.p12 === 'defect' ? 'defect' : 'na';
          answers.p13 = answers.p13 === 'defect' ? 'defect' : 'na';
        }
        const result = notInsp ? 'not_inspectable' : defects.some((d) => d.severity === 'critical') ? 'critical' : defects.length ? 'defects' : 'ok';
        const inspId = id();
        const inspector = pick(inspectors);
        const nd = notInsp ? null : addMonths(t, interval);
        insert('inspections', {
          id: inspId,
          tenant_id: tenantId,
          asset_id: assetId,
          inspector_id: inspector.id,
          kind: hi === 0 && history.length === 1 && rnd() < 0.3 ? 'initial' : 'periodic',
          reason: 'planned',
          status: 'submitted',
          result,
          answers: JSON.stringify(answers),
          maintenance: JSON.stringify({ items: rnd() < 0.5 ? [def.maintenance[Math.floor(rnd() * (def.maintenance.length - 1))].key] : [], defects, notInspectable: notInsp }),
          checkpoints: JSON.stringify(def.checkpoints),
          notes: notInsp ? pick(['Raum verschlossen, kein Schlüssel verfügbar', 'Zugang durch Lagerware versperrt', 'Bewohner wünschte keinen Zutritt']) : rnd() < 0.2 ? 'Mit Betreiber besprochen.' : '',
          signature: signature(inspector.name),
          signer_name: inspector.name,
          next_due_at: nd,
          inspected_at: t,
          created_at: t,
          updated_at: t,
        });
        for (const d of defects) {
          const did = id();
          const resolved = !isLast || rnd() < 0.25;
          insert('defects', {
            id: did,
            tenant_id: tenantId,
            property_id: propertyId,
            asset_id: assetId,
            inspection_id: inspId,
            checkpoint_id: d.checkpointId,
            title: d.title,
            note: d.note,
            legal_basis: '',
            severity: d.severity,
            status: resolved ? 'resolved' : 'open',
            created_at: t,
            resolved_at: resolved ? t + between(3, 40) * DAY : null,
            resolved_by: resolved ? inspector.id : null,
          });
          if (!resolved) openDefectRows.push({ id: did, assetId, cat: a.cat, title: d.title, severity: d.severity, propertyId });
        }
        lastId = inspId;
        lastResult = result;
        if (nd) nextDue = nd;
      }

      const historySql = sql.splice(assetSqlAt);
      insert('assets', {
        id: assetId,
        tenant_id: tenantId,
        building_id: buildingId,
        category: a.cat,
        code: c,
        location: a.location,
        floor: a.floor,
        manufacturer,
        model: pick(['Standard', 'Typ 2', 'Pro', 'S']) + (a.cat === 'extinguisher' ? ` ${attrs.size} kg` : ''),
        attributes: JSON.stringify(attrs),
        label_code: label,
        floor_plan_id: planId ?? null,
        marker_x: planId ? a.pos![0] : null,
        marker_y: planId ? a.pos![1] : null,
        last_inspection_id: lastId,
        last_inspected_at: history.length ? history[history.length - 1] : null,
        last_result: lastResult,
        next_due_at: nextDue,
        created_at: NOW - 700 * DAY,
        updated_at: NOW - 10 * DAY,
      });
      sql.push(...historySql);
    }
  }
}

// ---------- Aufgaben ----------
let shareToken = '';
openDefectRows.slice(0, 7).forEach((d, i) => {
  const tok = i < 3 ? Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url') : null;
  if (i === 0) shareToken = tok!;
  insert('tasks', {
    id: id(),
    tenant_id: tenantId,
    title: `Mangel beheben: ${d.title}`,
    description: 'Bitte Termin mit dem Objekt abstimmen und Behebung mit Foto dokumentieren.',
    status: i === 2 ? 'in_progress' : 'open',
    priority: d.severity === 'critical' || d.severity === 'high' ? 'high' : 'medium',
    due_at: NOW + (i - 2) * 6 * DAY,
    assignee_id: i % 2 ? people.inspector.id : people.owner.id,
    subcontractor_id: i < 5 ? subFor[d.cat] : null,
    share_token: tok,
    asset_id: d.assetId,
    defect_id: d.id,
    property_id: d.propertyId,
    created_by: people.owner.id,
    created_at: NOW - (10 - i) * DAY,
    updated_at: NOW - (10 - i) * DAY,
  });
});
const generalTasks: [string, string, number, string][] = [
  ['Flucht- und Rettungspläne Haus B aktualisieren', 'medium', 21, 'open'],
  ['Prüftermine Q4 mit Seniorenresidenz abstimmen', 'low', 10, 'open'],
  ['Brandschutzhelfer-Schulung Logistikzentrum organisieren', 'medium', 35, 'open'],
  ['Wartungsvertrag Feststellanlagen verlängern', 'high', -3, 'open'],
  ['Neue Feuerlöscher Halle 1 beschriften', 'low', -20, 'done'],
];
for (const [title, priority, dueDays, status] of generalTasks) {
  insert('tasks', {
    id: id(),
    tenant_id: tenantId,
    title,
    description: '',
    status,
    priority,
    due_at: NOW + dueDays * DAY,
    assignee_id: pick([people.owner.id, people.inspector.id, people.inspector2.id]),
    created_by: people.owner.id,
    created_at: NOW - 30 * DAY,
    updated_at: NOW - 5 * DAY,
  });
}

// ---------- Begehungen ----------
const [school, care, office] = properties as (PropertySpec & { id: string })[];
function walkthrough(p: PropertySpec & { id: string }, when: number, status: 'submitted' | 'draft', defectAt: number[], answeredShare = 1) {
  const qs = questionsFor(p.type);
  const answers: Record<string, string> = {};
  const findings: { questionId: string; title: string; note: string; severity: string }[] = [];
  qs.forEach((qq, i) => {
    if (i >= Math.round(qs.length * answeredShare)) return;
    if (defectAt.includes(i)) {
      answers[qq.id] = 'defect';
      findings.push({ questionId: qq.id, title: qq.text, note: pick(['Bei Rundgang festgestellt, Betreiber informiert', 'Frist 4 Wochen vereinbart', 'Sofort behoben']), severity: qq.severity });
    } else answers[qq.id] = rnd() < 0.08 ? 'na' : 'ok';
  });
  const wid = id();
  const result = findings.some((f) => f.severity === 'critical') ? 'critical' : findings.length ? 'defects' : 'ok';
  insert('walkthroughs', {
    id: wid,
    tenant_id: tenantId,
    property_id: p.id,
    building_id: null,
    building_type: p.type,
    inspector_id: people.owner.id,
    status,
    result: status === 'submitted' ? result : null,
    questions: JSON.stringify(qs),
    answers: JSON.stringify(answers),
    findings: JSON.stringify(findings),
    notes: status === 'submitted' ? 'Gesamteindruck gut. Organisatorische Punkte mit der Leitung besprochen.' : '',
    participants: status === 'submitted' ? `${p.contact[0]}, ${people.owner.name}` : '',
    signature: status === 'submitted' ? signature(people.owner.name) : null,
    signer_name: status === 'submitted' ? people.owner.name : '',
    inspected_at: status === 'submitted' ? when : null,
    next_due_at: status === 'submitted' ? addMonths(when, 12) : null,
    created_at: when,
    updated_at: when,
  });
  if (status === 'submitted') {
    findings.forEach((f, i) => {
      const q = qs.find((x) => x.id === f.questionId)!;
      const resolved = i === findings.length - 1;
      insert('defects', {
        id: id(),
        tenant_id: tenantId,
        property_id: p.id,
        walkthrough_id: wid,
        checkpoint_id: f.questionId,
        title: f.title,
        note: f.note,
        legal_basis: q.basis,
        severity: f.severity,
        status: resolved ? 'resolved' : 'open',
        created_at: when,
        resolved_at: resolved ? when + 7 * DAY : null,
        resolved_by: resolved ? people.owner.id : null,
      });
    });
  }
}
walkthrough(school, NOW - 120 * DAY, 'submitted', [0, 29, 46]);
walkthrough(care, NOW - 395 * DAY, 'submitted', [10, 33]);
walkthrough(office, NOW - 2 * DAY, 'draft', [5], 0.4);

// ---------- Vorlage angepasst + Aktivität ----------
const activity: [string, string, number][] = [
  ['import', '42 Elemente importiert', 690],
  ['create', 'Objekt „Logistikzentrum Nord“ angelegt', 400],
  ['update', 'Prüfvorlage „Feuerschutztür“ angepasst', 200],
  ['submit', 'Begehung Grundschule Am Stadtpark abgeschlossen', 120],
  ['invite', 'lesen@example.com eingeladen (Lesezugriff)', 60],
  ['external', 'Türtechnik Hansen KG: Aufgabe in Arbeit', 3],
];
for (const [action, summary, days] of activity) {
  insert('activity', { id: id(), tenant_id: tenantId, user_id: action === 'external' ? null : people.owner.id, action, entity: 'demo', entity_id: null, summary, created_at: NOW - days * DAY });
}

writeFileSync(join(out, 'seed.sql'), sql.join('\n') + '\n');
writeFileSync(join(out, 'r2.json'), JSON.stringify(r2, null, 2));
writeFileSync(join(out, 'info.json'), JSON.stringify({ tenantId, users: Object.values(people).map((p) => ({ email: p.email, role: p.role })), assets: assetCount, labels: labelCount, shareToken }, null, 2));
console.log(`OK: ${assetCount} Elemente, ${sql.length} SQL-Zeilen, ${r2.length} Grundrisse → ${out}`);

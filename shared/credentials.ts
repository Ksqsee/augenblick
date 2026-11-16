// Befähigungsnachweise je Mitglied (Plan v7, Paket X, Migration 0028) und die Auswahl für ein Protokoll:
// Je Elementart den passenden, am Prüfdatum gültigen Nachweis der prüfenden Person. Für Türen ist das in der Regel
// die Sachkunde (z. B. „Befähigte Person für Brandschutztüren“), für Feststellanlagen und Antriebe das persönliche
// Zertifikat des Herstellers (docs/wissen/seehafer-unterlagen.md, Abschnitt 8).

export const CREDENTIAL_KINDS = {
  expertise: 'Sachkunde',
  manufacturer: 'Hersteller-Zertifikat',
  other: 'Sonstiger Nachweis',
} as const;
export type CredentialKind = keyof typeof CREDENTIAL_KINDS;

export interface Credential {
  id: string;
  userId: string;
  kind: CredentialKind;
  /** Bezeichnung, z. B. „Befähigte Person für Brandschutztüren und -tore“ */
  title: string;
  issuer: string;
  number: string;
  /** Ende der Gültigkeit (ms); null = unbefristet */
  validUntil: number | null;
  /** Elementarten (Schlüssel); leer = gilt für alle */
  categories: string[];
}

/** Elementarten, bei denen das Hersteller-Zertifikat der prüfenden Person vorgeht. */
export const MANUFACTURER_FIRST = new Set(['hold_open', 'door_drive']);

export type CredentialStatus = 'ok' | 'expired' | 'missing';
export interface CredentialPick {
  status: CredentialStatus;
  credential: Credential | null;
}

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Gilt der Nachweis am Tag `at`? (`validUntil` ist das Ende des letzten gültigen Tages) */
export const isValidAt = (c: Pick<Credential, 'validUntil'>, at: number) => c.validUntil == null || c.validUntil >= at;

/**
 * Passenden Nachweis für eine Elementart wählen:
 * 1. nur Nachweise für diese Elementart (ausdrücklich oder „gilt für alle“),
 * 2. gültige vor abgelaufenen,
 * 3. ausdrücklich zugeordnete vor „gilt für alle“,
 * 4. die bevorzugte Art (Hersteller-Zertifikat bei Feststellanlage/Antrieb, sonst Sachkunde), sonstiges zuletzt,
 * 5. Aussteller passt zum Hersteller des Elements,
 * 6. am längsten gültig (unbefristet zuerst).
 * Gibt es nur abgelaufene, ist das Ergebnis „expired“ mit dem zuletzt abgelaufenen.
 */
export function pickCredential(list: Credential[], opts: { category: string; manufacturer?: string | null; at: number }): CredentialPick {
  const fits = list.filter((c) => !c.categories.length || c.categories.includes(opts.category));
  if (!fits.length) return { status: 'missing', credential: null };
  const prefer: CredentialKind = MANUFACTURER_FIRST.has(opts.category) ? 'manufacturer' : 'expertise';
  const maker = fold(opts.manufacturer ?? '');
  const score = (c: Credential) => [
    isValidAt(c, opts.at) ? 1 : 0,
    c.categories.includes(opts.category) ? 1 : 0,
    c.kind === prefer ? 2 : c.kind === 'other' ? 0 : 1,
    maker && c.issuer && (fold(c.issuer).includes(maker) || maker.includes(fold(c.issuer))) ? 1 : 0,
    c.validUntil == null ? Number.MAX_SAFE_INTEGER : c.validUntil,
  ];
  const sorted = [...fits].sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sb[i] - sa[i];
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
  const best = sorted[0]!;
  return { status: isValidAt(best, opts.at) ? 'ok' : 'expired', credential: best };
}

/** Kurztext für Protokoll und Liste: „Befähigte Person … · DGWZ · Nr. 123“ (ohne Datum). */
export function credentialText(c: Pick<Credential, 'kind' | 'title' | 'issuer' | 'number'>, label: (s: string) => string = (s) => s) {
  return [c.title.trim() || label(CREDENTIAL_KINDS[c.kind]), c.issuer.trim(), c.number.trim() ? `${label('Nr.')} ${c.number.trim()}` : ''].filter(Boolean).join(' · ');
}

/** Ende eines Kalendertages (JJJJ-MM-TT) in UTC als ms – so wird „gültig bis“ gespeichert. */
export function endOfDayUtc(ymd: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999);
}

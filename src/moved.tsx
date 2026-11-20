// Alte Adressen (Lesezeichen, gespeicherte Benachrichtigungen, Mails, PDFs, Connector) müssen weiter funktionieren:
// Ziel + alle Query-Parameter (+ Anker). Stand Plan v8 (docs/plan/v8.md 1, „Was wohin wandert“): zwei Orte, Objekte
// und Kalender. Heute, Prüfen, Offen und Berichte gibt es nicht mehr als Orte.
import { Navigate, useLocation } from 'react-router-dom';
import { useMe, useProperties } from './api';
import { lastPropertyId, startProperty } from './components/PropertyNav';
import { Spinner } from './components/ui';

/** Query-Parameter umbenennen (alt → neu), Rest unverändert; `set` setzt Werte (überschreibt alte). */
function rename(q: URLSearchParams, map: Record<string, string>, set: Record<string, string> = {}) {
  const n = new URLSearchParams(set);
  for (const [k, v] of q) if (!(k in set)) n.append(map[k] ?? k, v);
  return n;
}

export const MOVED: { from: string; to: string; query?: (q: URLSearchParams) => URLSearchParams }[] = [
  // Aufgaben stehen mit den Mängeln in der objektübergreifenden Liste /maengel (?art=…); ?id= öffnet das Detail
  {
    from: 'aufgaben',
    to: '/maengel',
    query: (q) => {
      const n = rename(q, { id: 'aufgabe' }, { art: 'aufgaben' });
      if (n.get('ansicht') === 'stats') n.delete('ansicht'); // Übersicht entfällt (Kennzahlen stehen in Berichte)
      return n;
    },
  },
  // „Prüfen“ als Ort entfällt: ausführliche Listen unter /pruefungen, Begehungen unter /begehungen
  { from: 'pruefen/begehungen', to: '/begehungen' },
  // Berichte liegen unter Einstellungen
  { from: 'berichte', to: '/einstellungen/berichte' },
  // Verwaltung liegt unter Einstellungen
  { from: 'team', to: '/einstellungen/team' },
  { from: 'subunternehmer', to: '/einstellungen/subunternehmer' },
  { from: 'import', to: '/einstellungen/import' },
  { from: 'hilfe', to: '/einstellungen/hilfe' },
];

/** Neue Adresse für einen alten Pfad samt Query – auch für Links im Code nutzbar. */
export function movedUrl(pathname: string, search = '', hash = '') {
  const m = MOVED.find((x) => `/${x.from}` === pathname.replace(/\/+$/, ''));
  if (!m) return null;
  const q = new URLSearchParams(search);
  const next = m.query ? m.query(q) : q;
  const qs = next.toString();
  return `${m.to}${qs ? `?${qs}` : ''}${hash}`;
}

export function Moved({ to }: { to: string }) {
  const loc = useLocation();
  const url = movedUrl(loc.pathname, loc.search, loc.hash) ?? to;
  return <Navigate to={url} replace />;
}

const withQuery = (path: string, q: URLSearchParams, hash = '') => `${path}${q.toString() ? `?${q}` : ''}${hash}`;

/**
 * /offen: ohne Parameter → Objektliste mit Filter „Mit Mängeln“ (objektübergreifend, Plan v8); mit Parametern
 * (?art=, ?mangel=, ?aufgabe=, ?tab= aus Benachrichtigungen und Links) → die objektübergreifende Liste /maengel.
 */
export function OffenMoved() {
  const loc = useLocation();
  const q = new URLSearchParams(loc.search);
  if (![...q.keys()].length) return <Navigate to="/objekte?filter=maengel" replace />;
  if (!q.get('art')) q.set('art', 'alle');
  return <Navigate to={withQuery('/maengel', q, loc.hash)} replace />;
}

/**
 * /pruefen: mit ?tab= → ausführliche Liste /pruefungen?tab=…; sonst ins zuletzt geöffnete Objekt (ohne: das
 * dringendste), Reiter Begehung – ?ansage=weiter (Rückweg nach einer angesagten Tür) geht mit. Ohne Objekt: Objektliste.
 * Kennt der Browser ein zuletzt geöffnetes Objekt, wird nichts geladen (auch ohne Netz).
 */
export function PruefenMoved() {
  const loc = useLocation();
  const q = new URLSearchParams(loc.search);
  const tenantId = useMe().data?.tenant.id;
  const remembered = lastPropertyId(tenantId);
  const props = useProperties();
  if (q.get('tab')) return <Navigate to={withQuery('/pruefungen', q, loc.hash)} replace />;
  const target = (id: string) => {
    const n = new URLSearchParams(q);
    n.set('tab', 'begehung');
    return withQuery(`/objekte/${id}`, n, loc.hash);
  };
  if (remembered) return <Navigate to={target(remembered)} replace />;
  if (props.isLoading && navigator.onLine) return <Spinner className="min-h-[40vh] items-center" />;
  const pick = startProperty(tenantId, props.data ?? []);
  return <Navigate to={pick ? target(pick) : '/objekte'} replace />;
}

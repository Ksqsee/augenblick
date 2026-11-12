// Alte Adressen aus der Zeit vor den fünf Orten (docs/plan/v4.md 5). Sie stehen in Lesezeichen, gespeicherten
// Benachrichtigungen und Mails und müssen weiter funktionieren: Ziel + alle Query-Parameter (+ Anker).
import { Navigate, useLocation } from 'react-router-dom';

/** Query-Parameter umbenennen (alt → neu), Rest unverändert. */
function rename(q: URLSearchParams, map: Record<string, string>, set: Record<string, string> = {}) {
  const n = new URLSearchParams(set);
  for (const [k, v] of q) if (!(k in set)) n.append(map[k] ?? k, v);
  return n;
}

export const MOVED: { from: string; to: string; query?: (q: URLSearchParams) => URLSearchParams }[] = [
  // Mängel und Aufgaben sind eine Arbeitsliste „Offen“; ?id= öffnet dort das Detail
  { from: 'maengel', to: '/offen', query: (q) => rename(q, { id: 'mangel' }, { art: 'maengel' }) },
  {
    from: 'aufgaben',
    to: '/offen',
    query: (q) => {
      const n = rename(q, { id: 'aufgabe' }, { art: 'aufgaben' });
      if (n.get('ansicht') === 'stats') n.delete('ansicht'); // Übersicht entfällt (Kennzahlen stehen in Berichte)
      return n;
    },
  },
  // Prüfungen und Begehungen gehören zu „Prüfen“; ohne ?tab= landet man im Überblick
  { from: 'pruefungen', to: '/pruefen' },
  { from: 'begehungen', to: '/pruefen/begehungen' },
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

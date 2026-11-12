import { useNavigate } from 'react-router-dom';
import { Tabs } from '../ui';

/**
 * Ansichten des Orts „Objekte“: die Objektliste (Objekte → Gebäude → Elemente) und die flache Liste „Alle Elemente“
 * (/elemente, bleibt als Unterseite erreichbar – Suche, Etiketten und alte Links zeigen dorthin).
 */
export function ObjectViews({ current }: { current: 'objekte' | 'elemente' }) {
  const navigate = useNavigate();
  return (
    <Tabs
      className="mb-5"
      value={current}
      onChange={(v) => navigate(v === 'objekte' ? '/objekte' : '/elemente')}
      tabs={[
        { value: 'objekte', label: 'Objekte' },
        { value: 'elemente', label: 'Alle Elemente' },
      ]}
    />
  );
}

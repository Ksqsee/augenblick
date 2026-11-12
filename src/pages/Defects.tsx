// Mängel (Ansicht in „Offen“): offene nach Dringlichkeit (Schwere, dann ohne Aufgabe, dann die ältesten zuerst),
// behobene, ausgeblendete. Was jetzt zu tun ist, steht als eine Warteschlange auf „Heute“ (GET /now).
import { useState } from 'react';
import { SEVERITIES, type Severity } from '../../shared/catalog';
import { api, type Defect, useAction, useDefects } from '../api';
import { Empty, ErrorBox, Kbd, SearchField, Segmented, SkeletonList, Surface, useToast, useUrlTab } from '../components/ui';
import { DefectRow } from '../components/work/DefectRow';
import { listKeys, TextAction, WorkGroup } from '../components/work/rows';

type Tab = 'open' | 'resolved' | 'hidden';
type Source = '' | 'asset' | 'walkthrough';

const SEV_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

/** Dringlichkeit innerhalb einer Schwere: Mängel ohne Aufgabe (oder mit erledigter) zuerst, dann die ältesten. */
export const byUrgency = (a: Defect, b: Defect) => {
  const free = (d: Defect) => (!d.taskId || d.taskStatus === 'done' || d.taskStatus === 'cancelled' ? 0 : 1);
  return free(a) - free(b) || a.createdAt - b.createdAt;
};

/**
 * Mängel als Ansicht in „Offen“ (?art=maengel): Status und Quelle als Umschalter, Suche. Detail, Behebung und
 * Aufgabe-anlegen liegen eine Ebene höher (OffenPage), damit sie aus jeder Ansicht gleich funktionieren.
 */
export function DefectsView({ canEdit, onOpen, onResolve }: { canEdit: boolean; onOpen: (id: string) => void; onResolve: (id: string) => void }) {
  // Alter Link ?tab=action (früherer Reiter „Handlungsbedarf“) landet bei „Offen“, nach Dringlichkeit sortiert
  const [tab, setTab] = useUrlTab<Tab>('tab', 'open', ['open', 'resolved', 'hidden']);
  const [source, setSource] = useState<Source>('');
  const [q, setQ] = useState('');
  // Zähler für den Umschalter (dieselbe Abfrage wie die Liste, also kein Mehraufwand)
  const openAll = useDefects('open', '', false);
  return (
    <>
      <div className="mb-4 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center">
        <SearchField value={q} onChange={setQ} placeholder="Mängel durchsuchen …" />
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'open', label: 'Offen', count: openAll.data?.length },
              { value: 'resolved', label: 'Behoben' },
              { value: 'hidden', label: 'Ausgeblendet' },
            ]}
          />
          <Segmented
            value={source}
            onChange={setSource}
            options={[
              { value: '', label: 'Alle' },
              { value: 'asset', label: 'Elemente' },
              { value: 'walkthrough', label: 'Begehungen' },
            ]}
          />
        </div>
      </div>
      <DefectList tab={tab} source={source} q={q} canEdit={canEdit} onOpen={onOpen} onResolve={onResolve} onReset={() => (setQ(''), setSource(''))} />
    </>
  );
}

function DefectList({
  tab,
  source,
  q,
  canEdit,
  onOpen,
  onResolve,
  onReset,
}: {
  tab: Tab;
  source: Source;
  q: string;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onResolve: (id: string) => void;
  onReset: () => void;
}) {
  const { data, isLoading, error, refetch } = useDefects(tab === 'hidden' ? 'all' : tab, source, tab === 'hidden');
  const toast = useToast();
  const reopen = useAction(
    (id: string) => api(`/defects/${id}`, { method: 'PATCH', body: { status: 'open' } }),
    () => toast('Wieder geöffnet'),
  );
  if (isLoading) return <SkeletonList rows={6} />;
  if (error) return <ErrorBox error={error} onRetry={() => refetch()} />;
  const needle = q.trim().toLowerCase();
  const rows = (data ?? []).filter(
    (d) => !needle || [d.title, d.code, d.location, d.buildingName, d.propertyName, d.note, d.measure, d.legalBasis].some((x) => x?.toLowerCase().includes(needle)),
  );
  if (!rows.length)
    return (
      <Surface>
        {needle || source ? (
          <Empty title="Kein Mangel passt zu Suche und Filter." action={<TextAction onClick={onReset}>Filter zurücksetzen</TextAction>} />
        ) : tab === 'open' ? (
          <Empty title="Keine offenen Mängel." text="Neue Mängel kommen aus Prüfungen, Begehungen oder über Erfassen." />
        ) : tab === 'hidden' ? (
          <Empty title="Nichts ausgeblendet." text="Doppelt oder irrtümlich erfasste Mängel kannst du im Detail ausblenden." />
        ) : (
          <Empty title="Noch nichts behoben." text="Behobene Mängel erscheinen hier – mit Notiz und Foto." />
        )}
      </Surface>
    );
  const groups =
    tab === 'open'
      ? SEV_ORDER.map((s) => ({
          key: s,
          label: SEVERITIES[s],
          items: rows.filter((d) => d.severity === s).sort(byUrgency),
        })).filter((g) => g.items.length)
      : [
          {
            key: tab,
            label: tab === 'hidden' ? 'Ausgeblendet' : 'Behoben',
            items: tab === 'resolved' ? [...rows].sort((a, b) => (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0)) : rows,
          },
        ];
  return (
    <>
      <Surface onKeyDown={listKeys()}>
        {groups.map((g) => (
          <WorkGroup key={g.key} label={g.label} count={g.items.length}>
            {g.items.map((d) => (
              <DefectRow key={d.id} d={d} canEdit={canEdit} onOpen={() => onOpen(d.id)} onResolve={() => onResolve(d.id)} onReopen={() => reopen.mutate(d.id)} />
            ))}
          </WorkGroup>
        ))}
      </Surface>
      <p className="mt-3 hidden items-center gap-1.5 text-caption text-ink-3 lg:flex">
        <Kbd>↑</Kbd>
        <Kbd>↓</Kbd> bewegen · <Kbd>Enter</Kbd> öffnen
      </p>
    </>
  );
}

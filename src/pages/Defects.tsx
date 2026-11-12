// Mängel: offene nach Dringlichkeit (Schwere, dann ohne Aufgabe, dann die ältesten zuerst), behobene, ausgeblendete.
// Was jetzt zu tun ist, steht als eine Warteschlange auf „Heute“ (GET /now) – kein eigener Reiter mehr.
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SEVERITIES, type Severity } from '../../shared/catalog';
import { api, type Defect, useAction, useDefects, useMe } from '../api';
import { ResolveDefectDialog } from '../components/DefectResolve';
import { Empty, ErrorBox, FilterBar, Kbd, PageHeader, Segmented, SkeletonList, Surface, Tabs, useToast, useUrlTab } from '../components/ui';
import { DefectPanel } from '../components/work/DefectPanel';
import { DefectRow } from '../components/work/DefectRow';
import { taskFromDefect } from '../components/work/model';
import { listKeys, TextAction, WorkGroup } from '../components/work/rows';
import { TaskForm } from '../components/work/TaskCreate';

type Tab = 'open' | 'resolved' | 'hidden';
type Source = '' | 'asset' | 'walkthrough';

const SEV_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

/** Dringlichkeit innerhalb einer Schwere: Mängel ohne Aufgabe (oder mit erledigter) zuerst, dann die ältesten. */
const byUrgency = (a: Defect, b: Defect) => {
  const free = (d: Defect) => (!d.taskId || d.taskStatus === 'done' || d.taskStatus === 'cancelled' ? 0 : 1);
  return free(a) - free(b) || a.createdAt - b.createdAt;
};

export function DefectsPage() {
  const [params, setParams] = useSearchParams();
  // Alter Link ?tab=action (früherer Reiter „Handlungsbedarf“) landet bei „Offen“, nach Dringlichkeit sortiert
  const [tab, setTab] = useUrlTab<Tab>('tab', 'open', ['open', 'resolved', 'hidden']);
  const [source, setSource] = useState<Source>('');
  const [q, setQ] = useState('');
  const { data: me } = useMe();
  const [taskFor, setTaskFor] = useState<Defect | null>(null);
  const [resolveId, setResolveId] = useState<string | null>(null);
  const canEdit = me?.user.role !== 'viewer';
  // Zähler für die Reiter (dieselben Abfragen wie die Listen, also kein Mehraufwand)
  const openAll = useDefects('open', '', false);

  // Detail über die URL (?id=…): Direktlinks aus Aufgaben und Benachrichtigungen
  const detail = params.get('id');
  const setDetail = (id: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (id) n.set('id', id);
        else n.delete('id');
        return n;
      },
      { replace: true },
    );

  return (
    <>
      <PageHeader title="Mängel" subtitle="Alle Mängel aus Prüfungen und Begehungen, objektübergreifend" />
      {/* Reihenfolge: Dialoge nach dem Detail, damit sie darüber liegen */}
      {detail && <DefectPanel key={detail} id={detail} onClose={() => setDetail(null)} onTask={setTaskFor} onResolve={setResolveId} />}
      {taskFor && <TaskForm initial={taskFromDefect(taskFor)} onClose={() => setTaskFor(null)} />}
      {resolveId && <ResolveDefectDialog defectId={resolveId} onClose={() => setResolveId(null)} />}
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'open', label: 'Offen', count: openAll.data?.length },
          { value: 'resolved', label: 'Behoben' },
          { value: 'hidden', label: 'Ausgeblendet' },
        ]}
      />
      <FilterBar
        search={{
          value: q,
          onChange: setQ,
          placeholder: 'Mängel durchsuchen …',
        }}
        trailing={
          <Segmented
            value={source}
            onChange={setSource}
            options={[
              { value: '', label: 'Alle' },
              { value: 'asset', label: 'Elemente' },
              { value: 'walkthrough', label: 'Begehungen' },
            ]}
          />
        }
      />
      <DefectList tab={tab} source={source} q={q} canEdit={canEdit} onOpen={setDetail} onResolve={setResolveId} onReset={() => (setQ(''), setSource(''))} />
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

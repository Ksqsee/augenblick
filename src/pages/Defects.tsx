import { ClipboardCheck, Siren, Wrench } from 'lucide-react';
import { Fragment, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SEVERITIES, type Severity } from '../../shared/catalog';
import { api, type ActionItem, type Defect, useAction, useActionRequired, useDefects, useMe } from '../api';
import { useStartInspection } from '../components/AssetDrawer';
import { ResolveDefectDialog } from '../components/DefectResolve';
import { Button, Empty, ErrorBox, FilterBar, Kbd, PageHeader, Segmented, SkeletonList, Surface, Tabs, useToast, useUrlTab } from '../components/ui';
import { DefectPanel } from '../components/work/DefectPanel';
import { DefectRow } from '../components/work/DefectRow';
import { taskFromDefect } from '../components/work/model';
import { listKeys, TextAction, WorkGroup } from '../components/work/rows';
import { TaskForm } from '../components/work/TaskCreate';
import { MetaLine } from '../components/work/TaskRow';
import { fmtDate } from '../format';

type Tab = 'action' | 'open' | 'resolved' | 'hidden';
type Source = '' | 'asset' | 'walkthrough';

const SEV_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

export function DefectsPage() {
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useUrlTab<Tab>('tab', 'open', ['action', 'open', 'resolved', 'hidden']);
  const [source, setSource] = useState<Source>('');
  const [q, setQ] = useState('');
  const { data: me } = useMe();
  const [taskFor, setTaskFor] = useState<Defect | null>(null);
  const [resolveId, setResolveId] = useState<string | null>(null);
  const canEdit = me?.user.role !== 'viewer';
  // Zähler für die Reiter (dieselben Abfragen wie die Listen, also kein Mehraufwand)
  const openAll = useDefects('open', '', false);
  const action = useActionRequired();

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
          { value: 'action', label: 'Handlungsbedarf', count: action.data?.length, tone: 'bad' },
          { value: 'open', label: 'Offen', count: openAll.data?.length },
          { value: 'resolved', label: 'Behoben' },
          { value: 'hidden', label: 'Ausgeblendet' },
        ]}
      />
      {tab === 'action' ? (
        <ActionRequired onDefect={setDetail} />
      ) : (
        <>
          <FilterBar
            search={{ value: q, onChange: setQ, placeholder: 'Mängel durchsuchen …' }}
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
      )}
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
  tab: Exclude<Tab, 'action'>;
  source: Source;
  q: string;
  canEdit: boolean;
  onOpen: (id: string) => void;
  onResolve: (id: string) => void;
  onReset: () => void;
}) {
  const { data, isLoading, error, refetch } = useDefects(tab === 'hidden' ? 'all' : tab, source, tab === 'hidden');
  const toast = useToast();
  const reopen = useAction((id: string) => api(`/defects/${id}`, { method: 'PATCH', body: { status: 'open' } }), () => toast('Wieder geöffnet'));
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
      ? SEV_ORDER.map((s) => ({ key: s, label: SEVERITIES[s], items: rows.filter((d) => d.severity === s) })).filter((g) => g.items.length)
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

const KIND_META = {
  defect: { icon: Siren, label: 'Mangel' },
  task: { icon: Wrench, label: 'Aufgabe' },
  asset: { icon: ClipboardCheck, label: 'Prüfung' },
} as const;

/** Handlungsbedarf: schwere Mängel ohne Aufgabe, überfällige Aufgaben und Elemente – nach Dringlichkeit. */
function ActionRequired({ onDefect }: { onDefect: (id: string) => void }) {
  const { data, isLoading, error, refetch } = useActionRequired();
  const navigate = useNavigate();
  const start = useStartInspection();
  const { data: me } = useMe();
  const canEdit = me?.user.role !== 'viewer';
  if (isLoading) return <SkeletonList rows={5} />;
  if (error) return <ErrorBox error={error} onRetry={() => refetch()} />;
  if (!data?.length)
    return (
      <Surface>
        <Empty title="Alles im Griff." text="Keine schweren Mängel ohne Aufgabe, keine überfälligen Aufgaben oder Prüfungen." />
      </Surface>
    );
  const counts = { defect: 0, task: 0, asset: 0 };
  for (const x of data) counts[x.kind]++;
  const lage = [
    counts.defect && `${counts.defect} schwere ${counts.defect === 1 ? 'Mangel' : 'Mängel'} ohne Aufgabe`,
    counts.task && `${counts.task} überfällige ${counts.task === 1 ? 'Aufgabe' : 'Aufgaben'}`,
    counts.asset && `${counts.asset} überfällige ${counts.asset === 1 ? 'Prüfung' : 'Prüfungen'}`,
  ].filter((x): x is string => !!x);
  const critical = (x: ActionItem) => x.kind === 'defect' && x.level === 'critical';
  return (
    <Surface>
      <section aria-label="Nach Dringlichkeit sortiert" className="pb-2">
        <p className="px-(--row-px) pt-5 pb-3 text-body text-ink-2 sm:pt-6">
          {lage.map((l, i) => (
            <Fragment key={l}>
              {i > 0 && (i === lage.length - 1 ? ' und ' : ', ')}
              <span className="text-ink">{l}</span>
            </Fragment>
          ))}
          . Nach Dringlichkeit sortiert.
        </p>
        <ul className="pk-list [--row-inset:28px]" onKeyDown={listKeys()}>
          {data.map((x) => {
            const M = KIND_META[x.kind];
            const open = () => (x.kind === 'defect' ? onDefect(x.id) : x.kind === 'task' ? navigate(`/aufgaben?id=${x.id}`) : navigate(`/elemente/${x.id}`));
            return (
              <li key={`${x.kind}-${x.id}`} className="group relative flex items-center transition-colors hover:bg-hover has-[[data-row-main]:focus-visible]:bg-hover" data-action={x.kind}>
                <button type="button" data-row-main onClick={open} className="flex min-h-[52px] min-w-0 flex-1 items-center gap-3 px-(--row-px) py-2 text-left outline-none sm:min-h-12">
                  <M.icon className="size-4 shrink-0 text-ink-3" aria-label={M.label} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-body text-ink">{x.title}</span>
                    <MetaLine
                      parts={[
                        <span className={critical(x) ? 'text-shu' : 'text-ink-2'}>{x.kind === 'defect' ? `${SEVERITIES[x.level as Severity] ?? ''} ${x.reason}`.trim() : x.reason}</span>,
                        x.subtitle,
                      ]}
                    />
                  </span>
                  <span className="shrink-0 text-meta text-ink-3 tabular-nums">
                    {x.kind === 'defect' ? fmtDate(x.at) : `seit ${fmtDate(x.at)}`}
                  </span>
                </button>
                {x.kind === 'asset' && canEdit && (
                  <span className="pointer-events-none absolute inset-y-0 right-0 hidden items-center bg-hover pr-(--row-px) pl-3 opacity-0 transition-opacity group-hover:pointer-events-auto group-hover:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100 sm:flex">
                    <Button size="sm" variant="secondary" loading={start.isPending && start.variables === x.id} onClick={() => start.mutate(x.id)}>
                      Prüfen
                    </Button>
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </Surface>
  );
}

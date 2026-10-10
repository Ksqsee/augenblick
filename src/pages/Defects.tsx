import clsx from 'clsx';
import { AlertTriangle, Check, ListPlus, RotateCcw } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { SEVERITIES } from '../../shared/catalog';
import { api, type Defect, fileUrl, useAction, useDefects, useMe } from '../api';
import { CategoryIcon } from '../components/CategoryIcon';
import { Badge, Button, Card, Empty, ErrorBox, PageHeader, Segmented, Spinner, useToast } from '../components/ui';
import { fmtDate } from '../format';
import { TaskForm } from './Tasks';

const sevTone = (s: Defect['severity']) => (s === 'critical' || s === 'high' ? 'bad' : s === 'medium' ? 'warn' : 'muted');

export function DefectsPage() {
  const [status, setStatus] = useState<'open' | 'resolved'>('open');
  const { data, isLoading, error } = useDefects(status);
  const { data: me } = useMe();
  const toast = useToast();
  const [taskFor, setTaskFor] = useState<Defect | null>(null);
  const canEdit = me?.user.role !== 'viewer';
  const setDefect = useAction(
    (v: { id: string; status: 'open' | 'resolved' }) => api(`/defects/${v.id}`, { method: 'PATCH', body: { status: v.status } }),
    (_, v) => toast(v.status === 'resolved' ? 'Als behoben markiert' : 'Wieder geöffnet'),
  );

  return (
    <>
      <PageHeader title="Mängel" subtitle="Alle Mängel aus Prüfungen, objektübergreifend" />
      {taskFor && (
        <TaskForm
          initial={{ title: `Mangel beheben: ${taskFor.title}`, description: `${taskFor.code} · ${taskFor.location ?? ''}\n${taskFor.note}`.trim(), assetId: taskFor.assetId ?? null, defectId: taskFor.id, priority: taskFor.severity === 'critical' || taskFor.severity === 'high' ? 'high' : 'medium' }}
          onClose={() => setTaskFor(null)}
        />
      )}
      <Segmented
        className="mb-4"
        value={status}
        onChange={setStatus}
        options={[
          { value: 'open', label: 'Offen' },
          { value: 'resolved', label: 'Behoben' },
        ]}
      />
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBox error={error} />
      ) : !data?.length ? (
        <Card>
          <Empty icon={<AlertTriangle className="size-5" />} title={status === 'open' ? 'Keine offenen Mängel' : 'Noch nichts behoben'} />
        </Card>
      ) : (
        <div className="grid gap-3">
          {data.map((d) => (
            <Card key={d.id} className={clsx('flex flex-col gap-3 p-4 sm:flex-row sm:items-center', d.severity === 'critical' && d.status === 'open' && 'border-bad/40')}>
              <div className="flex min-w-0 flex-1 gap-3">
                {d.category && <CategoryIcon category={d.category} size="sm" />}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{d.title}</p>
                    <Badge tone={sevTone(d.severity)}>{SEVERITIES[d.severity]}</Badge>
                    {d.taskId && <Badge tone="info">Aufgabe</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-3">
                    <Link to={`/elemente/${d.assetId}`} className="font-medium text-ink-2 hover:underline">
                      {d.code}
                    </Link>{' '}
                    · {[d.location, d.buildingName, d.propertyName].filter(Boolean).join(' · ')} · erfasst {fmtDate(d.createdAt)}
                    {d.resolvedAt && ` · behoben ${fmtDate(d.resolvedAt)}`}
                  </p>
                  {d.note && <p className="mt-1.5 text-sm text-ink-2">{d.note}</p>}
                </div>
              </div>
              {d.photoKey && (
                <a href={fileUrl(d.photoKey)} target="_blank" rel="noreferrer" className="shrink-0">
                  <img src={fileUrl(d.photoKey)} alt="Foto" className="h-16 w-20 rounded-lg border border-line object-cover" />
                </a>
              )}
              {canEdit && (
                <div className="flex shrink-0 gap-2">
                  {d.status === 'open' ? (
                    <>
                      {!d.taskId && (
                        <Button size="sm" variant="secondary" icon={<ListPlus className="size-3.5" />} onClick={() => setTaskFor(d)}>
                          Aufgabe
                        </Button>
                      )}
                      <Button size="sm" icon={<Check className="size-3.5" />} onClick={() => setDefect.mutate({ id: d.id, status: 'resolved' })}>
                        Behoben
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="ghost" icon={<RotateCcw className="size-3.5" />} onClick={() => setDefect.mutate({ id: d.id, status: 'open' })}>
                      Wieder öffnen
                    </Button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}

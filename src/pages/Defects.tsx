import clsx from 'clsx';
import { AlertTriangle, Check, Footprints, ListPlus, RotateCcw, Scale } from 'lucide-react';
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
  const [source, setSource] = useState<'' | 'asset' | 'walkthrough'>('');
  const { data, isLoading, error } = useDefects(status, source);
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
          initial={{
            title: `Mangel beheben: ${taskFor.title}`,
            description: [taskFor.code && `${taskFor.code} · ${taskFor.location ?? ''}`, taskFor.legalBasis && `Grundlage: ${taskFor.legalBasis}`, taskFor.note].filter(Boolean).join('\n'),
            assetId: taskFor.assetId ?? null,
            defectId: taskFor.id,
            propertyId: taskFor.propertyId ?? null,
            priority: taskFor.severity === 'critical' || taskFor.severity === 'high' ? 'high' : 'medium' }}
          onClose={() => setTaskFor(null)}
        />
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        <Segmented
          value={status}
          onChange={setStatus}
          options={[
            { value: 'open', label: 'Offen' },
            { value: 'resolved', label: 'Behoben' },
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
                {d.category ? (
                  <CategoryIcon category={d.category} size="sm" />
                ) : (
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-strong">
                    <Footprints className="size-4" />
                  </span>
                )}
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">{d.title}</p>
                    <Badge tone={sevTone(d.severity)}>{SEVERITIES[d.severity]}</Badge>
                    {d.taskId && <Badge tone="info">Aufgabe</Badge>}
                  </div>
                  <p className="mt-0.5 text-xs text-ink-3">
                    {d.assetId ? (
                      <Link to={`/elemente/${d.assetId}`} className="font-medium text-ink-2 hover:underline">
                        {d.code}
                      </Link>
                    ) : (
                      <Link to={`/druck/begehung/${d.walkthroughId}`} className="font-medium text-ink-2 hover:underline">
                        Begehung
                      </Link>
                    )}{' '}
                    · {[d.location, d.buildingName, d.propertyName].filter(Boolean).join(' · ')} · erfasst {fmtDate(d.createdAt)}
                    {d.resolvedAt && ` · behoben ${fmtDate(d.resolvedAt)}`}
                  </p>
                  {d.legalBasis && (
                    <p className="mt-1 inline-flex items-center gap-1 text-xs text-ink-3">
                      <Scale className="size-3" /> {d.legalBasis}
                    </p>
                  )}
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

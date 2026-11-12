// Einstellungen → Aktivität: Änderungen im Workspace, nach Tag gruppiert.
import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { useMemo, useState } from 'react';
import { api } from '../../api';
import { Avatar, Card, Empty, ErrorBox, FilterBar, SkeletonList } from '../../components/ui';
import { fmtDate, fmtDateTime } from '../../format';

interface Entry {
  id: string;
  summary: string;
  createdAt: number;
  userName: string | null;
}

const dayLabel = (ts: number) => {
  const d = fmtDate(ts);
  const today = fmtDate(Date.now());
  const yesterday = fmtDate(Date.now() - 86_400_000);
  return d === today ? 'Heute' : d === yesterday ? 'Gestern' : d;
};

export function ActivityTab() {
  const q = useQuery({ queryKey: ['activity'], queryFn: () => api<Entry[]>('/account/activity') });
  const [search, setSearch] = useState('');
  const groups = useMemo(() => {
    const s = search.trim().toLowerCase();
    const rows = (q.data ?? []).filter((a) => !s || `${a.summary} ${a.userName ?? ''}`.toLowerCase().includes(s));
    const m = new Map<string, Entry[]>();
    for (const r of rows) {
      const k = dayLabel(r.createdAt);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [q.data, search]);
  if (q.isLoading) return <SkeletonList rows={8} />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length)
    return (
      <Card>
        <Empty icon={<History />} title="Noch keine Aktivität" text="Änderungen an Objekten, Elementen, Prüfungen und Einstellungen erscheinen hier." />
      </Card>
    );
  return (
    <div className="max-w-3xl">
      <FilterBar search={{ value: search, onChange: setSearch, placeholder: 'Aktivität durchsuchen …' }} />
      {!groups.length ? (
        <Card>
          <Empty compact title="Keine Treffer" text="Anderen Suchbegriff versuchen." />
        </Card>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([day, rows]) => (
            <section key={day}>
              <h2 className="mb-2 text-meta font-medium text-ink-3">{day}</h2>
              <Card>
                <ul className="divide-y divide-line">
                  {rows.map((a) => (
                    <li key={a.id} className="flex items-start gap-3 px-4 py-3">
                      <Avatar name={a.userName ?? 'Extern'} size="sm" className="mt-0.5" />
                      <div className="min-w-0 flex-1">
                        <p className="text-body break-words text-ink">{a.summary}</p>
                        <p className="mt-0.5 text-meta text-ink-3">
                          {a.userName ?? 'extern'} · <span className="tabular-nums">{fmtDateTime(a.createdAt)}</span>
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

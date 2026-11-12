// Einstellungen → Aktivität: Änderungen im Workspace, nach Tag gruppiert – eine ruhige, zeitlich geordnete Liste.
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { api } from '../../api';
import { DayHeading, fmtTime, groupByDay } from '../../components/admin';
import { Avatar, Empty, ErrorBox, FilterBar, SkeletonList, Surface } from '../../components/ui';

interface Entry {
  id: string;
  summary: string;
  createdAt: number;
  userName: string | null;
}

export function ActivityTab() {
  const q = useQuery({ queryKey: ['activity'], queryFn: () => api<Entry[]>('/account/activity') });
  const [search, setSearch] = useState('');
  const groups = useMemo(() => {
    const s = search.trim().toLowerCase();
    const rows = (q.data ?? []).filter((a) => !s || `${a.summary} ${a.userName ?? ''}`.toLowerCase().includes(s));
    return groupByDay(rows, (r) => r.createdAt);
  }, [q.data, search]);
  if (q.isLoading) return <SkeletonList rows={8} />;
  if (q.error) return <ErrorBox error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data?.length)
    return (
      <Surface>
        <Empty title="Noch keine Aktivität" text="Änderungen an Objekten, Elementen, Prüfungen und Einstellungen erscheinen hier." />
      </Surface>
    );
  return (
    <>
      <FilterBar search={{ value: search, onChange: setSearch, placeholder: 'Aktivität durchsuchen …' }} />
      <Surface>
        {!groups.length ? (
          <Empty compact title="Keine Treffer" text="Anderen Suchbegriff versuchen." />
        ) : (
          <ul className="pk-list py-2 sm:py-3" aria-label="Aktivität">
            {groups.flatMap(([day, rows]) => [
              <DayHeading key={`d-${day}`}>{day}</DayHeading>,
              ...rows.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-(--row-px) py-2.5" style={{ '--row-inset': '36px' } as React.CSSProperties}>
                  <Avatar name={a.userName ?? 'Extern'} size="sm" className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="text-body break-words text-ink">{a.summary}</p>
                    <p className="mt-0.5 text-meta text-ink-3">{a.userName ?? 'extern'}</p>
                  </div>
                  <span className="shrink-0 pt-0.5 text-meta text-ink-3 tabular-nums">{fmtTime(a.createdAt)}</span>
                </li>
              )),
            ])}
          </ul>
        )}
      </Surface>
    </>
  );
}

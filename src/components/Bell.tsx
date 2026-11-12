import clsx from 'clsx';
import { Bell as BellIcon, CheckCheck, Settings2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Notification, queryClient, useNotifications } from '../api';
import { fmtRelative } from '../format';
import { Segmented } from './ui';

export function Bell({ align = 'right' }: { align?: 'left' | 'right' }) {
  const { data } = useNotifications();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<'all' | 'unread'>('all');
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      document.removeEventListener('keydown', k);
    };
  }, [open]);
  const markRead = async (ids?: string[]) => {
    await api('/notifications/read', { body: { ids } });
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
  const unread = data?.unread ?? 0;
  const items = (data?.items ?? []).filter((n) => filter === 'all' || !n.readAt);
  const fresh = items.filter((n) => !n.readAt);
  const earlier = items.filter((n) => n.readAt);
  const row = (n: Notification) => (
    <li key={n.id}>
      <button
        type="button"
        className="flex w-full gap-3 rounded-md px-3 py-2.5 text-left transition-colors hover:bg-hover"
        onClick={async () => {
          setOpen(false);
          if (!n.readAt) await markRead([n.id]);
          if (n.link) navigate(n.link);
        }}
      >
        <span className={clsx('mt-[7px] size-1.5 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-ink')} aria-label={n.readAt ? undefined : 'Ungelesen'} />
        <span className="min-w-0 flex-1">
          <span className={clsx('block text-body', n.readAt ? 'text-ink-2' : 'text-ink')}>{n.title}</span>
          {n.body && <span className="mt-0.5 line-clamp-2 text-meta text-ink-3">{n.body}</span>}
          <span className="mt-0.5 block text-caption text-ink-3">{fmtRelative(n.createdAt)}</span>
        </span>
      </button>
    </li>
  );
  const group = (title: string, list: Notification[]) =>
    list.length > 0 && (
      <div>
        <p className="px-3 pt-2 pb-1 text-meta font-medium text-ink-3">{title}</p>
        <ul>{list.map(row)}</ul>
      </div>
    );
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="relative grid size-10 place-items-center rounded-lg text-ink-2 hover:bg-sunken hover:text-ink sm:size-9"
        aria-label={`Benachrichtigungen${unread ? ` (${unread} neu)` : ''}`}
      >
        <BellIcon className="size-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-4 font-semibold text-white tabular-nums ring-2 ring-canvas">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Benachrichtigungen"
          className={clsx(
            'animate-menu z-50 flex flex-col overflow-hidden rounded-xl bg-surface shadow-pop',
            'max-sm:fixed max-sm:inset-x-3 max-sm:top-16 max-sm:max-h-[calc(100dvh-10rem)]',
            'sm:absolute sm:top-full sm:mt-2 sm:max-h-[min(70vh,560px)] sm:w-[380px]',
            align === 'right' ? 'sm:right-0' : 'sm:left-0',
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <p className="flex items-baseline gap-2 text-body font-semibold">
              Benachrichtigungen
              {unread > 0 && <span className="text-meta font-normal text-ink-3 tabular-nums">{unread}</span>}
            </p>
            {unread > 0 && (
              <button type="button" onClick={() => markRead()} className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-meta font-medium text-ink-2 hover:bg-sunken hover:text-ink">
                <CheckCheck className="size-4" /> Alle gelesen
              </button>
            )}
          </div>
          {(data?.items.length ?? 0) > 0 && (
            <div className="border-b border-line px-3 py-2">
              <Segmented
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'all', label: 'Alle' },
                  { value: 'unread', label: 'Ungelesen', count: unread },
                ]}
              />
            </div>
          )}
          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
            {!items.length ? (
              <div className="flex flex-col items-center px-6 py-10 text-center">
                <p className="text-body text-ink">{filter === 'unread' ? 'Alles gelesen' : 'Keine Benachrichtigungen'}</p>
                <p className="mt-1 text-meta text-ink-3">Fälligkeiten, Mängel und Aufgaben melden sich hier.</p>
              </div>
            ) : (
              <>
                {group('Neu', fresh)}
                {group('Früher', earlier)}
              </>
            )}
          </div>
          <Link
            to="/einstellungen?tab=notifications"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 border-t border-line px-4 py-2.5 text-meta font-medium text-ink-2 hover:bg-hover hover:text-ink"
          >
            <Settings2 className="size-4" /> Einstellungen für Benachrichtigungen
          </Link>
        </div>
      )}
    </div>
  );
}

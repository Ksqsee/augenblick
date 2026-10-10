import clsx from 'clsx';
import { Bell as BellIcon, CheckCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, queryClient, useNotifications } from '../api';
import { fmtRelative } from '../format';

export function Bell({ align = 'right' }: { align?: 'left' | 'right' }) {
  const { data } = useNotifications();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  const markRead = async (ids?: string[]) => {
    await api('/notifications/read', { body: { ids } });
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
  const unread = data?.unread ?? 0;
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-lg p-2 text-ink-2 hover:bg-sunken hover:text-ink" aria-label={`Benachrichtigungen${unread ? ` (${unread} neu)` : ''}`}>
        <BellIcon className="size-5" />
        {unread > 0 && (
          <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-brand px-1 text-[10px] leading-4 font-semibold text-white">{unread > 9 ? '9+' : unread}</span>
        )}
      </button>
      {open && (
        <div
          className={clsx(
            'animate-in absolute top-full z-50 mt-2 w-[min(360px,calc(100vw-24px))] overflow-hidden rounded-xl border border-line bg-surface shadow-pop',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-sm font-semibold">Benachrichtigungen</p>
            {unread > 0 && (
              <button onClick={() => markRead()} className="inline-flex items-center gap-1 text-xs font-medium text-ink-2 hover:text-ink">
                <CheckCheck className="size-3.5" /> Alle gelesen
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] divide-y divide-line overflow-y-auto">
            {!data?.items.length ? (
              <li className="px-4 py-8 text-center text-sm text-ink-3">Keine Benachrichtigungen</li>
            ) : (
              data.items.map((n) => (
                <li key={n.id}>
                  <button
                    className={clsx('flex w-full gap-3 px-4 py-3 text-left hover:bg-sunken/60', !n.readAt && 'bg-brand-soft/40')}
                    onClick={async () => {
                      setOpen(false);
                      if (!n.readAt) await markRead([n.id]);
                      if (n.link) navigate(n.link);
                    }}
                  >
                    <span className={clsx('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-brand')} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{n.title}</span>
                      {n.body && <span className="block truncate text-xs text-ink-3">{n.body}</span>}
                      <span className="block text-[11px] text-ink-3">{fmtRelative(n.createdAt)}</span>
                    </span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

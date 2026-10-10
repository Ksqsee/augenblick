import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Building, Building2, Search as SearchIcon } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type SearchResult } from '../api';
import { categoryLabel } from '../format';
import { CategoryIcon } from './CategoryIcon';

interface Hit {
  key: string;
  to: string;
  icon: ReactNode;
  title: string;
  sub: string;
}

export function useSearchShortcut(open: () => void) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        open();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open]);
}

export function SearchButton({ onClick, className }: { onClick: () => void; className?: string }) {
  return (
    <button
      onClick={onClick}
      className={clsx('flex h-10 w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 text-sm text-ink-3 shadow-card hover:border-line-strong', className)}
    >
      <SearchIcon className="size-4" />
      <span className="flex-1 text-left">Suchen …</span>
      <kbd className="hidden rounded border border-line px-1.5 text-[11px] sm:inline">Strg K</kbd>
    </button>
  );
}

export function SearchPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [idx, setIdx] = useState(0);
  const navigate = useNavigate();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 180);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  const { data, isFetching } = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => api<SearchResult>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
    staleTime: 10_000,
  });
  const hits: Hit[] = useMemo(() => {
    if (!data) return [];
    return [
      ...data.assets.map((a) => ({
        key: `a${a.id}`,
        to: `/elemente/${a.id}`,
        icon: <CategoryIcon category={a.category} size="sm" />,
        title: `${a.code} · ${categoryLabel(a.category)}`,
        sub: [a.location, a.buildingName, a.propertyName].filter(Boolean).join(' · '),
      })),
      ...data.properties.map((p) => ({
        key: `p${p.id}`,
        to: `/objekte/${p.id}`,
        icon: (
          <span className="grid size-8 place-items-center rounded-lg bg-sunken text-ink-2">
            <Building2 className="size-4" />
          </span>
        ),
        title: p.name,
        sub: p.address.split('\n').join(', '),
      })),
      ...data.buildings.map((b) => ({
        key: `b${b.id}`,
        to: `/objekte/${b.propertyId}`,
        icon: (
          <span className="grid size-8 place-items-center rounded-lg bg-sunken text-ink-2">
            <Building className="size-4" />
          </span>
        ),
        title: b.name,
        sub: b.propertyName,
      })),
    ];
  }, [data]);
  useEffect(() => setIdx(0), [hits]);
  const go = (h: Hit) => {
    navigate(h.to);
    onClose();
  };
  return (
    <div className="fixed inset-0 z-[70] flex items-start justify-center bg-ink/30 p-4 pt-[12vh] backdrop-blur-[2px]" onMouseDown={onClose}>
      <div className="animate-in w-full max-w-xl overflow-hidden rounded-2xl bg-surface shadow-pop" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Suche">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <SearchIcon className="size-5 text-ink-3" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setIdx((i) => Math.min(hits.length - 1, i + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setIdx((i) => Math.max(0, i - 1));
              } else if (e.key === 'Enter' && hits[idx]) go(hits[idx]);
            }}
            placeholder="Element-Code, Standort, Objekt, Gebäude …"
            className="h-14 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
          />
          {isFetching && <span className="text-xs text-ink-3">…</span>}
        </div>
        <ul className="max-h-[50vh] overflow-y-auto p-1.5">
          {debounced.length < 2 ? (
            <li className="px-3 py-6 text-center text-sm text-ink-3">Mindestens 2 Zeichen eingeben</li>
          ) : hits.length === 0 && !isFetching ? (
            <li className="px-3 py-6 text-center text-sm text-ink-3">Keine Treffer</li>
          ) : (
            hits.map((h, i) => (
              <li key={h.key}>
                <button
                  onMouseEnter={() => setIdx(i)}
                  onClick={() => go(h)}
                  className={clsx('flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left', i === idx && 'bg-sunken')}
                >
                  {h.icon}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{h.title}</span>
                    <span className="block truncate text-xs text-ink-3">{h.sub || '–'}</span>
                  </span>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

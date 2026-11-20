import clsx from 'clsx';
import { Building2, CalendarDays, Check, ChevronsUpDown, ClipboardList, LayoutList, LogOut, Mic, Plus, ScanLine, Search as SearchIcon, Settings, WifiOff } from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLES } from '../../shared/catalog';
import { api, clearMeCache, type Me, queryClient, useMe } from '../api';
import { useOnline, useOutbox } from '../offline';
import { Bell } from './Bell';
import { CaptureSheet, openCapture, useCaptureListener } from './CaptureSheet';
import { PropertyForm } from './forms';
import { Logo } from './Logo';
import { AmpelFilters, canCreateProperty, PropertyLink, rememberProperty, useIsDesktop, usePropertyList } from './PropertyNav';
import { SearchPalette, useSearchShortcut } from './Search';
import { Avatar, Skeleton } from './ui';

/**
 * Zwei Orte (docs/plan/v8.md 1): Objekte und Kalender, dazu Einstellungen. Am Desktop ist die linke Leiste die
 * Objektliste, am Handy ist sie die Startseite. match: Pfade, die zum Ort gehören (Unterseiten, alte Adressen).
 */
const PLACES = {
  objekte: /^\/(objekte|elemente|e|grundrisse|maengel|unterschreiben|pruefungen|begehungen|begehung|rundgang|scan|offline)(\/|$)/,
  kalender: /^\/kalender(\/|$)/,
  einstellungen: /^\/einstellungen(\/|$)/,
};
const placeOf = (path: string) => (Object.keys(PLACES) as (keyof typeof PLACES)[]).find((k) => PLACES[k].test(path));

/** Breite der linken Leiste (Objektliste) am Desktop. */
const SIDEBAR = 'lg:w-[272px]';

function NavItem({ to, label, icon, badge, active }: { to: string; label: string; icon: ReactNode; badge?: number; active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-body font-medium transition-colors [&>svg]:size-4 [&>svg]:shrink-0',
        active ? 'bg-selected text-ink [&>svg]:text-ink' : 'text-ink-2 hover:bg-sunken/70 hover:text-ink [&>svg]:text-ink-3',
      )}
    >
      {icon}
      <span className="truncate">{label}</span>
      {!!badge && <span className="ml-auto text-meta font-normal text-ink-3 tabular-nums">{badge}</span>}
    </Link>
  );
}

/**
 * Konto-Menü: Seiten ohne eigenen Ort (Alle Elemente, Mängel und Aufgaben, Offline, Scannen), Einstellungen, Workspace
 * wechseln, Abmelden. Desktop unten in der Leiste (klappt nach oben auf), Handy als Avatar in der Kopfzeile.
 */
function AccountMenu({ me, variant }: { me: Me; variant: 'sidebar' | 'header' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const loc = useLocation();
  const outbox = useOutbox();
  useEffect(() => setOpen(false), [loc.pathname, loc.search]);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const k = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', h);
    window.addEventListener('keydown', k);
    return () => {
      document.removeEventListener('mousedown', h);
      window.removeEventListener('keydown', k);
    };
  }, [open]);
  const item = 'flex h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-left text-body text-ink-2 hover:bg-sunken hover:text-ink lg:h-9 [&>svg]:size-4 [&>svg]:text-ink-3';
  const header = variant === 'header';
  return (
    <div className="relative" ref={ref}>
      {header ? (
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Konto und Einstellungen" className="grid size-10 place-items-center rounded-md hover:bg-sunken">
          <Avatar name={me.user.name} size="sm" />
        </button>
      ) : (
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-sunken/70">
          <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface text-meta font-semibold text-ink shadow-card">{me.tenant.name.slice(0, 1).toUpperCase()}</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-meta font-medium">{me.tenant.name}</span>
            <span className="block truncate text-caption text-ink-3">
              {me.user.name} · {ROLES[me.user.role]}
            </span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-ink-3" />
        </button>
      )}
      {open && (
        <div
          role="menu"
          aria-label="Konto"
          className={clsx('animate-menu absolute z-40 rounded-lg bg-surface p-1 shadow-pop', header ? 'top-full right-0 mt-1 w-[min(18rem,calc(100vw-2rem))]' : 'inset-x-0 bottom-full mb-1')}
        >
          <div className="flex items-center gap-2.5 px-2.5 pt-2 pb-2.5">
            <Avatar name={me.user.name} size="sm" />
            <span className="min-w-0 flex-1">
              {header && <span className="block truncate text-meta font-medium text-ink">{me.tenant.name}</span>}
              <span className="block truncate text-meta text-ink-2">{me.user.email}</span>
            </span>
          </div>
          <div className="my-1 h-px bg-line" />
          <Link role="menuitem" to="/elemente" className={item}>
            <LayoutList /> Alle Elemente
          </Link>
          <Link role="menuitem" to="/maengel?art=alle" className={item}>
            <ClipboardList /> Mängel und Aufgaben
          </Link>
          {header && (
            <Link role="menuitem" to="/scan" className={item}>
              <ScanLine /> Code scannen
            </Link>
          )}
          <Link role="menuitem" to="/offline" className={item}>
            <WifiOff /> Offline-Modus
            {outbox.length > 0 && <span className="ml-auto text-meta text-ink-3 tabular-nums">{outbox.length}</span>}
          </Link>
          <Link role="menuitem" to="/einstellungen" className={item}>
            <Settings /> Einstellungen
          </Link>
          {me.workspaces.length > 1 && (
            <>
              <div className="my-1 h-px bg-line" />
              <p className="px-2.5 pt-1.5 pb-1 text-caption font-medium text-ink-3">Workspaces</p>
              {me.workspaces.map((w) => (
                <button
                  key={w.id}
                  role="menuitem"
                  className="flex h-10 w-full items-center gap-2 rounded-md px-2.5 text-left text-body hover:bg-sunken lg:h-9"
                  onClick={async () => {
                    await api('/account/switch', { body: { tenantId: w.id } });
                    queryClient.clear();
                    navigate('/objekte');
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{w.name}</span>
                  {w.id === me.tenant.id && <Check className="size-4 text-ink-2" />}
                </button>
              ))}
            </>
          )}
          <div className="my-1 h-px bg-line" />
          <button
            role="menuitem"
            className={item}
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' }).catch(() => {});
              clearMeCache();
              queryClient.clear();
              navigate('/login');
            }}
          >
            <LogOut /> Abmelden
          </button>
          {header && <LegalLinks className="px-2.5 pt-2 pb-1.5" />}
        </div>
      )}
    </div>
  );
}

function LegalLinks({ className }: { className?: string }) {
  return (
    <div className={clsx('flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-ink-3', className)}>
      <NavLink to="/rechtliches/terms" className="hover:text-ink">
        Nutzungsbedingungen
      </NavLink>
      <NavLink to="/rechtliches/privacy" className="hover:text-ink">
        Datenschutz
      </NavLink>
      <NavLink to="/rechtliches/dpa" className="hover:text-ink">
        AVV
      </NavLink>
    </div>
  );
}

/** Objektliste in der Leiste: Suchfeld, Erfassen/Neues Objekt/Scannen, Filter, Zeilen mit Ampel. */
function PropertySidebarList({ me, onNew }: { me: Me; onNew: () => void }) {
  const [q, setQ] = useState('');
  const { query, all, rows, counts, filter, setFilter, now } = usePropertyList(q);
  const location = useLocation();
  const current = location.pathname.match(/^\/objekte\/([^/]+)/)?.[1];
  return (
    <>
      <div className="mt-4 flex flex-col gap-2">
        <div className="relative">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-ink-3" />
          <input
            type="search"
            aria-label="Liste durchsuchen"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Objekt suchen …"
            className="h-8 w-full rounded-md border border-line bg-surface pr-2 pl-8 text-body text-ink outline-none placeholder:text-ink-3 hover:border-line-strong focus:border-ink [&::-webkit-search-cancel-button]:hidden"
          />
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => openCapture(contextFromPath(location.pathname))}
            className="flex h-9 flex-1 items-center justify-center gap-2 rounded-md bg-ink text-body font-medium text-white transition-opacity hover:bg-ink/85 active:opacity-85"
          >
            <Mic className="size-4" /> Erfassen
          </button>
          {canCreateProperty(me) && (
            <button
              type="button"
              onClick={onNew}
              title="Neues Objekt"
              className="grid size-9 place-items-center rounded-md text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
            >
              <Plus className="size-4" />
              <span className="sr-only">Neues Objekt</span>
            </button>
          )}
          <NavLink to="/scan" aria-label="Code scannen" title="Code scannen" className="grid size-9 place-items-center rounded-md text-ink-2 transition-colors hover:bg-sunken hover:text-ink">
            <ScanLine className="size-4" />
          </NavLink>
        </div>
      </div>

      <div className="mt-5 flex items-center justify-between px-2">
        <p className="text-meta font-medium text-ink-3">
          Objekte {all.length > 0 && <span className="font-normal tabular-nums">{all.length}</span>}
        </p>
      </div>
      {all.length > 1 && (
        <div className="mt-1.5 px-1">
          <AmpelFilters compact value={filter} onChange={setFilter} counts={counts} />
        </div>
      )}
      <nav aria-label="Liegenschaften" className="scroll-thin -mx-3 mt-1.5 min-h-0 flex-1 overflow-y-auto px-3 pb-2">
        {query.isLoading ? (
          <div className="flex flex-col gap-3 px-2 pt-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-8" />
            ))}
          </div>
        ) : rows.length ? (
          <ul className="flex flex-col gap-px">
            {rows.map((p) => (
              <li key={p.id}>
                <PropertyLink p={p} now={now} variant="sidebar" active={p.id === current} />
              </li>
            ))}
          </ul>
        ) : all.length ? (
          <p className="px-2 pt-2 text-meta text-ink-3">
            Kein Objekt passt.{' '}
            <button
              type="button"
              className="font-medium text-ink-2 underline-offset-4 hover:text-ink hover:underline"
              onClick={() => {
                setQ('');
                setFilter('alle');
              }}
            >
              Filter zurücksetzen
            </button>
          </p>
        ) : (
          <p className="px-2 pt-2 text-meta text-ink-3">Noch keine Objekte.</p>
        )}
      </nav>
    </>
  );
}

function Sidebar({ me, onSearch, onNew }: { me: Me; onSearch: () => void; onNew: () => void }) {
  const location = useLocation();
  const place = placeOf(location.pathname);
  return (
    <div className="flex h-full flex-col px-3 pt-3 pb-3">
      <div className="flex h-10 items-center justify-between pr-0.5 pl-2">
        <Logo />
        <div className="flex items-center">
          <button
            onClick={onSearch}
            aria-label="Suchen"
            title="Suchen (Strg K)"
            className="grid size-9 place-items-center rounded-md text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
          >
            <SearchIcon className="size-4" />
          </button>
          <Bell align="left" />
        </div>
      </div>

      <PropertySidebarList me={me} onNew={onNew} />

      <div className="mt-2 border-t border-line pt-2">
        <nav aria-label="Orte" className="flex flex-col gap-px">
          <NavItem to="/kalender" label="Kalender" icon={<CalendarDays />} active={place === 'kalender'} />
          <NavItem to="/einstellungen" label="Einstellungen" icon={<Settings />} active={place === 'einstellungen'} />
        </nav>
        <div className="mt-2">
          <AccountMenu me={me} variant="sidebar" />
        </div>
        <LegalLinks className="mt-2 px-2" />
      </div>
    </div>
  );
}

/** Seite → Kontext fürs Erfassen (Element oder Objekt vorwählen) */
function contextFromPath(path: string) {
  const a = path.match(/^\/elemente\/([^/]+)/);
  if (a) return { assetId: a[1] };
  const p = path.match(/^\/objekte\/([^/]+)/);
  if (p) return { propertyId: p[1] };
  return {};
}

function Tab({ to, icon, label, active }: { to: string; icon: ReactNode; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors [&>svg]:size-[22px] [&>svg]:stroke-[1.75]',
        active ? 'text-ink' : 'text-ink-3',
      )}
    >
      {icon}
      {label}
    </Link>
  );
}

export function Shell() {
  const { data: me } = useMe();
  const [search, setSearch] = useState(false);
  const [creating, setCreating] = useState(false);
  const openSearch = useCallback(() => setSearch(true), []);
  useSearchShortcut(openSearch);
  const online = useOnline();
  const loc = useLocation();
  const desktop = useIsDesktop();
  const [capture, closeCapture] = useCaptureListener();
  // „zuletzt geöffnetes Objekt“ – Ziel von /pruefen und Start am Desktop
  const opened = loc.pathname.match(/^\/objekte\/([a-z0-9]{1,40})$/)?.[1];
  const tenantId = me?.tenant.id;
  useEffect(() => {
    if (opened && tenantId) rememberProperty(tenantId, opened);
  }, [opened, tenantId]);
  if (!me) return null;
  const place = placeOf(loc.pathname);
  return (
    <div className="min-h-dvh lg:pl-[272px]">
      {/* Die Leiste lädt die Objektliste – am Handy gar nicht erst einhängen */}
      {desktop && (
        <aside className={clsx('no-print fixed inset-y-0 left-0 z-20 hidden bg-canvas lg:block', SIDEBAR)}>
          <Sidebar me={me} onSearch={openSearch} onNew={() => setCreating(true)} />
        </aside>
      )}
      {search && <SearchPalette onClose={() => setSearch(false)} />}
      {creating && <PropertyForm onClose={() => setCreating(false)} onCreated={(id) => openCapture({ propertyId: id, mode: 'assets' })} />}

      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between bg-canvas/90 px-4 backdrop-blur-md lg:hidden">
        <Link to="/objekte" aria-label="Startseite">
          <Logo />
        </Link>
        <div className="-mr-2 flex items-center">
          <Bell />
          <button onClick={openSearch} className="grid size-10 place-items-center rounded-md text-ink-2 hover:bg-sunken hover:text-ink" aria-label="Suchen">
            <SearchIcon className="size-5" />
          </button>
          <AccountMenu me={me} variant="header" />
        </div>
      </header>

      {!online && (
        <NavLink to="/offline" className="no-print sticky top-14 z-20 flex items-center justify-center gap-2 bg-ink px-4 py-1.5 text-meta font-medium text-white lg:top-0">
          <WifiOff className="size-4" /> Keine Verbindung – im Offline-Modus weiterprüfen
        </NavLink>
      )}
      <main key={loc.pathname} className="animate-in mx-auto max-w-6xl px-4 pt-3 pb-28 sm:px-6 sm:pt-5 lg:px-10 lg:pt-8 lg:pb-16">
        <Outlet />
      </main>

      {/* Handy: Objekte · Erfassen · Kalender (Einstellungen und Seiten ohne Ort im Konto-Menü oben rechts) */}
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
        aria-label="Hauptnavigation"
      >
        <Tab to="/objekte" icon={<Building2 />} label="Objekte" active={place === 'objekte'} />
        <div className="flex items-center justify-center">
          <button
            onClick={() => openCapture(contextFromPath(loc.pathname))}
            aria-label="Erfassen"
            className={clsx('grid size-[52px] place-items-center rounded-full text-white transition-[background-color,opacity] active:opacity-85', capture ? 'bg-shu' : 'bg-ink')}
          >
            <Mic className="size-[22px]" />
          </button>
        </div>
        <Tab to="/kalender" icon={<CalendarDays />} label="Kalender" active={place === 'kalender'} />
      </nav>
      {capture && <CaptureSheet initial={capture} onClose={closeCapture} />}
    </div>
  );
}

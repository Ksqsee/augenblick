import clsx from 'clsx';
import {
  AlertTriangle,
  Building2,
  ChevronDown,
  ChevronsUpDown,
  ClipboardCheck,
  CloudOff,
  FileSpreadsheet,
  FileText,
  Footprints,
  HardHat,
  LifeBuoy,
  WifiOff,
  ListTodo,
  LogOut,
  Menu,
  Mic,
  Package,
  ScanLine,
  Search as SearchIcon,
  Settings,
  Sun,
  Users,
  X,
  Check,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLES } from '../../shared/catalog';
import { api, clearMeCache, type Me, queryClient, useMe } from '../api';
import { useOnline, useOutbox } from '../offline';
import { Bell } from './Bell';
import { CaptureSheet, openCapture, useCaptureListener } from './CaptureSheet';
import { Logo } from './Logo';
import { SearchPalette, useSearchShortcut } from './Search';
import { Avatar, Kbd } from './ui';

const NAV: { to: string; label: string; icon: ReactNode; group: 'main' | 'more' }[] = [
  { to: '/', label: 'Heute', icon: <Sun />, group: 'main' },
  { to: '/objekte', label: 'Objekte', icon: <Building2 />, group: 'main' },
  { to: '/elemente', label: 'Elemente', icon: <Package />, group: 'main' },
  { to: '/pruefungen', label: 'Prüfungen', icon: <ClipboardCheck />, group: 'main' },
  { to: '/maengel', label: 'Mängel', icon: <AlertTriangle />, group: 'main' },
  { to: '/aufgaben', label: 'Aufgaben', icon: <ListTodo />, group: 'main' },
  { to: '/begehungen', label: 'Begehungen', icon: <Footprints />, group: 'main' },
  { to: '/berichte', label: 'Berichte', icon: <FileText />, group: 'more' },
  { to: '/offline', label: 'Offline-Modus', icon: <CloudOff />, group: 'more' },
  { to: '/import', label: 'Import', icon: <FileSpreadsheet />, group: 'more' },
  { to: '/team', label: 'Team', icon: <Users />, group: 'more' },
  { to: '/subunternehmer', label: 'Subunternehmer', icon: <HardHat />, group: 'more' },
  { to: '/einstellungen', label: 'Einstellungen', icon: <Settings />, group: 'more' },
  { to: '/hilfe', label: 'Anleitung & Hilfe', icon: <LifeBuoy />, group: 'more' },
];

function NavItem({ to, label, icon, badge, onClick }: { to: string; label: string; icon: ReactNode; badge?: number; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        clsx(
          'group relative flex h-10 items-center gap-2.5 rounded-md px-2 text-body font-medium transition-colors lg:h-8 [&>svg]:size-4 [&>svg]:shrink-0',
          isActive ? 'bg-selected text-ink [&>svg]:text-ink' : 'text-ink-2 hover:bg-sunken/70 hover:text-ink [&>svg]:text-ink-3',
        )
      }
    >
      {icon}
      <span className="truncate">{label}</span>
      {!!badge && <span className="ml-auto text-meta font-normal text-ink-3 tabular-nums">{badge}</span>}
    </NavLink>
  );
}

/** Workspace und Konto – unten in der Seitenleiste, Menü klappt nach oben auf. */
function WorkspaceSwitcher({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-md p-1.5 text-left transition-colors hover:bg-sunken/70"
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-surface text-meta font-semibold text-ink shadow-card">{me.tenant.name.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-meta font-medium">{me.tenant.name}</span>
          <span className="block truncate text-caption text-ink-3">
            {me.user.name} · {ROLES[me.user.role]}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-ink-3" />
      </button>
      {open && (
        <div className="animate-menu absolute inset-x-0 bottom-full z-30 mb-1 rounded-lg bg-surface p-1 shadow-pop">
          <div className="flex items-center gap-2.5 px-2.5 pt-2 pb-2.5">
            <Avatar name={me.user.name} size="sm" />
            <span className="min-w-0 flex-1 truncate text-meta text-ink-2">{me.user.email}</span>
          </div>
          {me.workspaces.length > 1 && (
            <>
              <div className="my-1 h-px bg-line" />
              <p className="px-2.5 pt-1.5 pb-1 text-caption font-medium text-ink-3">Workspaces</p>
              {me.workspaces.map((w) => (
                <button
                  key={w.id}
                  className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-body hover:bg-sunken"
                  onClick={async () => {
                    await api('/account/switch', { body: { tenantId: w.id } });
                    queryClient.clear();
                    navigate('/');
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
            className="flex h-9 w-full items-center gap-2 rounded-md px-2.5 text-left text-body text-ink-2 hover:bg-sunken hover:text-ink"
            onClick={async () => {
              await api('/auth/logout', { method: 'POST' }).catch(() => {});
              clearMeCache();
              queryClient.clear();
              navigate('/login');
            }}
          >
            <LogOut className="size-4" /> Abmelden
          </button>
        </div>
      )}
    </div>
  );
}

function Sidebar({ me, onNavigate, onSearch, onClose }: { me: Me; onNavigate?: () => void; onSearch: () => void; onClose?: () => void }) {
  const outbox = useOutbox();
  const location = useLocation();
  const inMore = NAV.some((n) => n.group === 'more' && n.to !== '/' && location.pathname.startsWith(n.to));
  const [more, setMore] = useState(() => {
    try {
      return localStorage.getItem('pk:nav-more') !== '0';
    } catch {
      return true;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('pk:nav-more', more ? '1' : '0');
    } catch {
      /* egal */
    }
  }, [more]);
  const showMore = more || inMore;
  return (
    <div className="flex h-full flex-col px-3 pt-3 pb-3">
      <div className="flex h-10 items-center justify-between pr-0.5 pl-2">
        <Logo />
        {onClose ? (
          <button onClick={onClose} className="grid size-10 place-items-center rounded-md text-ink-2 hover:bg-sunken" aria-label="Menü schließen">
            <X className="size-5" />
          </button>
        ) : (
          <Bell align="left" />
        )}
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <button
          onClick={() => {
            onNavigate?.();
            onSearch();
          }}
          className="flex h-10 w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-body text-ink-3 transition-colors hover:border-line-strong lg:h-8"
        >
          <SearchIcon className="size-4" />
          <span className="flex-1 text-left">Suchen …</span>
          <span className="hidden lg:inline-flex">
            <Kbd>Strg K</Kbd>
          </span>
        </button>
        <div className="grid grid-cols-[1fr_auto] gap-1">
          <button
            onClick={() => {
              onNavigate?.();
              openCapture(contextFromPath(location.pathname));
            }}
            className="flex h-10 items-center justify-center gap-2 rounded-md bg-ink text-body font-medium text-white transition-opacity hover:bg-ink/85 active:opacity-85 lg:h-9"
          >
            <Mic className="size-4" /> Erfassen
          </button>
          <NavLink
            to="/scan"
            onClick={onNavigate}
            aria-label="Code scannen"
            title="Code scannen"
            className="grid size-10 place-items-center rounded-md text-ink-2 transition-colors hover:bg-sunken hover:text-ink lg:size-9"
          >
            <ScanLine className="size-4" />
          </NavLink>
        </div>
      </div>

      <nav className="scroll-thin -mx-3 mt-6 flex flex-1 flex-col gap-px overflow-y-auto px-3">
        {NAV.filter((n) => n.group === 'main').map((n) => (
          <NavItem key={n.to} {...n} onClick={onNavigate} />
        ))}
        <button
          onClick={() => setMore((m) => !m)}
          aria-expanded={showMore}
          className="mt-6 mb-1 flex h-7 items-center gap-1 px-2 text-meta font-medium text-ink-3 transition-colors hover:text-ink"
        >
          Mehr <ChevronDown className={clsx('size-3.5 transition-transform', !showMore && '-rotate-90')} />
        </button>
        {showMore &&
          NAV.filter((n) => n.group === 'more').map((n) => (
            <NavItem key={n.to} {...n} badge={n.to === '/offline' ? outbox.length : undefined} onClick={onNavigate} />
          ))}
      </nav>

      <div className="mt-3 pt-2">
        <WorkspaceSwitcher me={me} />
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 px-2 text-[11px] text-ink-3">
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

const tabCls = ({ isActive }: { isActive: boolean }) =>
  clsx(
    'relative flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors [&>svg]:size-[22px] [&>svg]:stroke-[1.75]',
    isActive ? 'text-ink' : 'text-ink-3',
  );

function Tab({ to, end, icon, label }: { to: string; end?: boolean; icon: ReactNode; label: string }) {
  return (
    <NavLink to={to} end={end} className={tabCls}>
      {icon}
      {label}
    </NavLink>
  );
}

export function Shell() {
  const { data: me } = useMe();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const openSearch = useCallback(() => setSearch(true), []);
  useSearchShortcut(openSearch);
  const online = useOnline();
  const loc = useLocation();
  const [capture, closeCapture] = useCaptureListener();
  useEffect(() => {
    if (!menu) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && setMenu(false);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [menu]);
  if (!me) return null;
  return (
    <div className="min-h-dvh lg:pl-[232px]">
      <aside className="no-print fixed inset-y-0 left-0 hidden w-[232px] bg-canvas lg:block">
        <Sidebar me={me} onSearch={openSearch} />
      </aside>
      {search && <SearchPalette onClose={() => setSearch(false)} />}

      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between bg-canvas/90 px-4 backdrop-blur-md lg:hidden">
        <Logo />
        <div className="-mr-2 flex items-center">
          <Bell />
          <button onClick={openSearch} className="grid size-10 place-items-center rounded-md text-ink-2 hover:bg-sunken hover:text-ink" aria-label="Suchen">
            <SearchIcon className="size-5" />
          </button>
        </div>
      </header>
      {menu && (
        <div className="animate-fade fixed inset-0 z-50 bg-black/30 lg:hidden" onClick={() => setMenu(false)}>
          <div className="animate-slide-left h-full w-[min(20rem,86vw)] bg-canvas pb-[env(safe-area-inset-bottom)] shadow-pop" onClick={(e) => e.stopPropagation()}>
            <Sidebar me={me} onNavigate={() => setMenu(false)} onSearch={openSearch} onClose={() => setMenu(false)} />
          </div>
        </div>
      )}

      {!online && (
        <NavLink to="/offline" className="no-print sticky top-14 z-20 flex items-center justify-center gap-2 bg-ink px-4 py-1.5 text-meta font-medium text-white lg:top-0">
          <WifiOff className="size-4" /> Keine Verbindung – im Offline-Modus weiterprüfen
        </NavLink>
      )}
      <main key={loc.pathname} className="animate-in mx-auto max-w-6xl px-4 pt-3 pb-28 sm:px-6 sm:pt-5 lg:px-10 lg:pt-8 lg:pb-16">
        <Outlet />
      </main>

      <nav
        className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
        aria-label="Hauptnavigation"
      >
        <Tab to="/" end icon={<Sun />} label="Heute" />
        <Tab to="/pruefungen" icon={<ClipboardCheck />} label="Prüfen" />
        <div className="flex items-center justify-center">
          <button
            onClick={() => openCapture(contextFromPath(loc.pathname))}
            aria-label="Erfassen"
            className={clsx('grid size-[52px] place-items-center rounded-full text-white transition-[background-color,opacity] active:opacity-85', capture ? 'bg-shu' : 'bg-ink')}
          >
            <Mic className="size-[22px]" />
          </button>
        </div>
        <Tab to="/maengel" icon={<AlertTriangle />} label="Mängel" />
        <button onClick={() => setMenu(true)} className={tabCls({ isActive: false })}>
          <Menu />
          Mehr
        </button>
      </nav>
      {capture && <CaptureSheet initial={capture} onClose={closeCapture} />}
    </div>
  );
}

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
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLES } from '../../shared/catalog';
import { api, clearMeCache, type Me, queryClient, useMe } from '../api';
import { useOnline, useOutbox } from '../offline';
import { Bell } from './Bell';
import { CaptureSheet, openCapture, useCaptureListener } from './CaptureSheet';
import { Logo } from './Logo';
import { SearchButton, SearchPalette, useSearchShortcut } from './Search';

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

function NavItem({ to, label, icon, onClick }: { to: string; label: string; icon: ReactNode; onClick?: () => void }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      onClick={onClick}
      className={({ isActive }) =>
        clsx(
          'flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium transition [&>svg]:size-[18px]',
          isActive ? 'bg-surface text-ink shadow-card [&>svg]:text-brand' : 'text-ink-2 hover:bg-sunken hover:text-ink [&>svg]:text-ink-3',
        )
      }
    >
      {icon}
      {label}
    </NavLink>
  );
}

function WorkspaceSwitcher({ me }: { me: Me }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-sunken">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-ink text-sm font-semibold text-white">{me.tenant.name.slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{me.tenant.name}</span>
          <span className="block truncate text-xs text-ink-3">
            {me.user.name} · {ROLES[me.user.role]}
          </span>
        </span>
        <ChevronsUpDown className="size-4 text-ink-3" />
      </button>
      {open && (
        <div className="animate-in absolute inset-x-0 top-full z-30 mt-1 rounded-xl border border-line bg-surface p-1 shadow-pop">
          {me.workspaces.length > 1 &&
            me.workspaces.map((w) => (
              <button
                key={w.id}
                className={clsx('flex w-full items-center rounded-lg px-3 py-2 text-left text-sm hover:bg-sunken', w.id === me.tenant.id && 'font-semibold')}
                onClick={async () => {
                  await api('/account/switch', { body: { tenantId: w.id } });
                  queryClient.clear();
                  navigate('/');
                  setOpen(false);
                }}
              >
                {w.name}
              </button>
            ))}
          <button
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-2 hover:bg-sunken"
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

function Sidebar({ me, onNavigate, onSearch }: { me: Me; onNavigate?: () => void; onSearch: () => void }) {
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
    <div className="flex h-full flex-col gap-5 p-3">
      <div className="flex items-center justify-between px-2 pt-2">
        <Logo />
        <div className="hidden lg:block">
          <Bell align="left" />
        </div>
      </div>
      <WorkspaceSwitcher me={me} />
      <SearchButton
        onClick={() => {
          onNavigate?.();
          onSearch();
        }}
      />
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button
          onClick={() => {
            onNavigate?.();
            openCapture(contextFromPath(location.pathname));
          }}
          className="flex h-11 items-center justify-center gap-2 rounded-xl bg-brand text-sm font-semibold text-white shadow-sm transition hover:bg-brand-strong active:scale-[0.98]"
        >
          <Mic className="size-[18px]" /> Erfassen
        </button>
        <NavLink to="/scan" onClick={onNavigate} aria-label="Code scannen" title="Code scannen" className="grid size-11 place-items-center rounded-xl bg-surface text-ink shadow-card hover:bg-sunken">
          <ScanLine className="size-[18px]" />
        </NavLink>
      </div>
      <nav className="flex flex-1 flex-col gap-0.5">
        {NAV.filter((n) => n.group === 'main').map((n) => (
          <NavItem key={n.to} {...n} onClick={onNavigate} />
        ))}
        <button
          onClick={() => setMore((m) => !m)}
          aria-expanded={showMore}
          className="mt-3 flex h-8 items-center gap-2 px-3 text-[11px] font-semibold tracking-wider text-ink-3 uppercase hover:text-ink"
        >
          Mehr <ChevronDown className={clsx('size-3.5 transition', showMore && 'rotate-180')} />
        </button>
        {showMore &&
          NAV.filter((n) => n.group === 'more').map((n) => (
            <NavItem key={n.to} {...n} label={n.to === '/offline' && outbox.length ? `${n.label} (${outbox.length})` : n.label} onClick={onNavigate} />
          ))}
      </nav>
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 pb-2 text-[11px] text-ink-3">
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
  clsx('flex flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium [&>svg]:size-[22px]', isActive ? 'text-ink' : 'text-ink-3');

export function Shell() {
  const { data: me } = useMe();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const openSearch = useCallback(() => setSearch(true), []);
  useSearchShortcut(openSearch);
  const online = useOnline();
  const loc = useLocation();
  const [capture, closeCapture] = useCaptureListener();
  if (!me) return null;
  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 overflow-y-auto border-r border-line bg-canvas lg:block">
        <Sidebar me={me} onSearch={openSearch} />
      </aside>
      {search && <SearchPalette onClose={() => setSearch(false)} />}

      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        <div className="flex">
          <Bell />
          <button onClick={openSearch} className="rounded-lg p-2 hover:bg-sunken" aria-label="Suchen">
            <SearchIcon className="size-5" />
          </button>
        </div>
      </header>
      {menu && (
        <div className="fixed inset-0 z-50 bg-ink/30 lg:hidden" onClick={() => setMenu(false)}>
          <div className="animate-in h-full w-72 overflow-y-auto bg-canvas" onClick={(e) => e.stopPropagation()}>
            <Sidebar me={me} onNavigate={() => setMenu(false)} onSearch={openSearch} />
          </div>
        </div>
      )}

      {!online && (
        <NavLink
          to="/offline"
          className="no-print sticky top-14 z-20 flex items-center justify-center gap-2 bg-warn px-4 py-1.5 text-[13px] font-medium text-white lg:top-0"
        >
          <WifiOff className="size-4" /> Keine Verbindung – im Offline-Modus weiterprüfen
        </NavLink>
      )}
      <main key={loc.pathname} className="animate-in mx-auto max-w-6xl px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-12">
        <Outlet />
      </main>

      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 items-end border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden" aria-label="Hauptnavigation">
        <NavLink to="/" end className={tabCls}>
          <Sun />
          Heute
        </NavLink>
        <NavLink to="/pruefungen" className={tabCls}>
          <ClipboardCheck />
          Prüfen
        </NavLink>
        <div className="flex justify-center">
          <button
            onClick={() => openCapture(contextFromPath(loc.pathname))}
            aria-label="Erfassen"
            className="-mt-5 mb-1 grid size-14 place-items-center rounded-full bg-brand text-white shadow-lift ring-4 ring-canvas transition active:scale-95"
          >
            <Mic className="size-6" />
          </button>
        </div>
        <NavLink to="/maengel" className={tabCls}>
          <AlertTriangle />
          Mängel
        </NavLink>
        <button onClick={() => setMenu(true)} className={tabCls({ isActive: false })}>
          <Menu />
          Mehr
        </button>
      </nav>
      {capture && <CaptureSheet initial={capture} onClose={closeCapture} />}
    </div>
  );
}


import clsx from 'clsx';
import {
  AlertTriangle,
  Building2,
  ChevronsUpDown,
  ClipboardCheck,
  FileText,
  WifiOff,
  LogOut,
  Mic,
  ScanLine,
  Search as SearchIcon,
  Settings,
  Sun,
  Check,
} from 'lucide-react';
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLES } from '../../shared/catalog';
import { api, clearMeCache, type Me, queryClient, useMe } from '../api';
import { useOnline, useOutbox } from '../offline';
import { Bell } from './Bell';
import { CaptureSheet, openCapture, useCaptureListener } from './CaptureSheet';
import { Logo } from './Logo';
import { SearchPalette, useSearchShortcut } from './Search';
import { Avatar, Kbd } from './ui';

/**
 * Die fünf Orte (docs/plan/v4.md 5). Alles andere liegt unter Einstellungen (Zahnrad/Konto-Menü).
 * match: Pfade, die zum Ort gehören (Unterseiten, alte Adressen) – für die Hervorhebung.
 */
const PLACES: { to: string; label: string; icon: ReactNode; match: RegExp }[] = [
  { to: '/', label: 'Heute', icon: <Sun />, match: /^\/$/ },
  { to: '/objekte', label: 'Objekte', icon: <Building2 />, match: /^\/(objekte|elemente|e|grundrisse)(\/|$)/ },
  { to: '/pruefen', label: 'Prüfen', icon: <ClipboardCheck />, match: /^\/(pruefen|pruefungen|begehungen|rundgang|scan|offline)(\/|$)/ },
  { to: '/offen', label: 'Offen', icon: <AlertTriangle />, match: /^\/(offen|maengel|aufgaben)(\/|$)/ },
  { to: '/berichte', label: 'Berichte', icon: <FileText />, match: /^\/berichte(\/|$)/ },
];
const placeOf = (path: string) => PLACES.find((p) => p.match.test(path))?.to;

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
 * Konto-Menü: Workspace wechseln, Einstellungen, Abmelden. Desktop unten in der Seitenleiste (klappt nach oben auf),
 * Handy als Avatar in der Kopfzeile (klappt nach unten auf) – dort auch Berichte, der fünfte Ort ohne Platz in der Leiste.
 */
function AccountMenu({ me, variant }: { me: Me; variant: 'sidebar' | 'header' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const loc = useLocation();
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
          {header && (
            <Link role="menuitem" to="/berichte" className={item}>
              <FileText /> Berichte
            </Link>
          )}
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

function Sidebar({ me, onSearch }: { me: Me; onSearch: () => void }) {
  const outbox = useOutbox();
  const location = useLocation();
  const place = placeOf(location.pathname);
  const inSettings = /^\/einstellungen(\/|$)/.test(location.pathname);
  return (
    <div className="flex h-full flex-col px-3 pt-3 pb-3">
      <div className="flex h-10 items-center justify-between pr-0.5 pl-2">
        <Logo />
        <Bell align="left" />
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <button
          onClick={onSearch}
          className="flex h-8 w-full items-center gap-2 rounded-md border border-line bg-surface px-2.5 text-body text-ink-3 transition-colors hover:border-line-strong"
        >
          <SearchIcon className="size-4" />
          <span className="flex-1 text-left">Suchen …</span>
          <Kbd>Strg K</Kbd>
        </button>
        <div className="grid grid-cols-[1fr_auto] gap-1">
          <button
            onClick={() => openCapture(contextFromPath(location.pathname))}
            className="flex h-9 items-center justify-center gap-2 rounded-md bg-ink text-body font-medium text-white transition-opacity hover:bg-ink/85 active:opacity-85"
          >
            <Mic className="size-4" /> Erfassen
          </button>
          <NavLink
            to="/scan"
            aria-label="Code scannen"
            title="Code scannen"
            className="grid size-9 place-items-center rounded-md text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
          >
            <ScanLine className="size-4" />
          </NavLink>
        </div>
      </div>

      <nav aria-label="Orte" className="scroll-thin -mx-3 mt-6 flex flex-1 flex-col gap-px overflow-y-auto px-3">
        {PLACES.map((n) => (
          <NavItem key={n.to} to={n.to} label={n.label} icon={n.icon} active={place === n.to} badge={n.to === '/pruefen' ? outbox.length : undefined} />
        ))}
      </nav>

      <div className="mt-3 pt-2">
        <div className="flex items-center gap-1">
          <div className="min-w-0 flex-1">
            <AccountMenu me={me} variant="sidebar" />
          </div>
          <Link
            to="/einstellungen"
            aria-label="Einstellungen"
            title="Einstellungen"
            aria-current={inSettings ? 'page' : undefined}
            className={clsx('grid size-9 shrink-0 place-items-center rounded-md transition-colors hover:bg-sunken hover:text-ink', inSettings ? 'bg-selected text-ink' : 'text-ink-2')}
          >
            <Settings className="size-4" />
          </Link>
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
  const openSearch = useCallback(() => setSearch(true), []);
  useSearchShortcut(openSearch);
  const online = useOnline();
  const loc = useLocation();
  const [capture, closeCapture] = useCaptureListener();
  if (!me) return null;
  const place = placeOf(loc.pathname);
  const tab = (to: string) => {
    const p = PLACES.find((x) => x.to === to)!;
    return <Tab to={p.to} icon={p.icon} label={p.label} active={place === p.to} />;
  };
  return (
    <div className="min-h-dvh lg:pl-[232px]">
      <aside className="no-print fixed inset-y-0 left-0 z-20 hidden w-[232px] bg-canvas lg:block">
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

      {/* Handy: Heute · Prüfen · Erfassen · Offen · Objekte (Berichte und Einstellungen im Konto-Menü oben rechts) */}
      <nav
        className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md lg:hidden"
        aria-label="Hauptnavigation"
      >
        {tab('/')}
        {tab('/pruefen')}
        <div className="flex items-center justify-center">
          <button
            onClick={() => openCapture(contextFromPath(loc.pathname))}
            aria-label="Erfassen"
            className={clsx('grid size-[52px] place-items-center rounded-full text-white transition-[background-color,opacity] active:opacity-85', capture ? 'bg-shu' : 'bg-ink')}
          >
            <Mic className="size-[22px]" />
          </button>
        </div>
        {tab('/offen')}
        {tab('/objekte')}
      </nav>
      {capture && <CaptureSheet initial={capture} onClose={closeCapture} />}
    </div>
  );
}

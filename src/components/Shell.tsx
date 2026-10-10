import clsx from 'clsx';
import {
  AlertTriangle,
  Building2,
  ChevronsUpDown,
  ClipboardCheck,
  FileText,
  LayoutGrid,
  ListTodo,
  LogOut,
  Menu,
  Package,
  ScanLine,
  Settings,
  Users,
} from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ROLES } from '../../shared/catalog';
import { api, type Me, queryClient, useMe } from '../api';
import { Logo } from './Logo';

const NAV: { to: string; label: string; icon: ReactNode; group: string }[] = [
  { to: '/', label: 'Übersicht', icon: <LayoutGrid />, group: 'Arbeit' },
  { to: '/objekte', label: 'Objekte', icon: <Building2 />, group: 'Arbeit' },
  { to: '/elemente', label: 'Elemente', icon: <Package />, group: 'Arbeit' },
  { to: '/pruefungen', label: 'Prüfungen', icon: <ClipboardCheck />, group: 'Arbeit' },
  { to: '/maengel', label: 'Mängel', icon: <AlertTriangle />, group: 'Arbeit' },
  { to: '/aufgaben', label: 'Aufgaben', icon: <ListTodo />, group: 'Arbeit' },
  { to: '/berichte', label: 'Berichte', icon: <FileText />, group: 'Auswertung' },
  { to: '/team', label: 'Team', icon: <Users />, group: 'Verwaltung' },
  { to: '/einstellungen', label: 'Einstellungen', icon: <Settings />, group: 'Verwaltung' },
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
              await api('/auth/logout', { method: 'POST' });
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

function Sidebar({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const groups = [...new Set(NAV.map((n) => n.group))];
  return (
    <div className="flex h-full flex-col gap-5 p-3">
      <div className="px-2 pt-2">
        <Logo />
      </div>
      <WorkspaceSwitcher me={me} />
      <NavLink
        to="/scan"
        onClick={onNavigate}
        className="flex h-10 items-center justify-center gap-2 rounded-lg bg-brand text-sm font-semibold text-white shadow-sm transition hover:bg-brand-strong"
      >
        <ScanLine className="size-[18px]" /> Code scannen
      </NavLink>
      <nav className="flex flex-col gap-4">
        {groups.map((g) => (
          <div key={g} className="flex flex-col gap-0.5">
            <p className="px-3 pb-1 text-[11px] font-semibold tracking-wider text-ink-3 uppercase">{g}</p>
            {NAV.filter((n) => n.group === g).map((n) => (
              <NavItem key={n.to} {...n} onClick={onNavigate} />
            ))}
          </div>
        ))}
      </nav>
    </div>
  );
}

const MOBILE = [NAV[0], NAV[3], { to: '/scan', label: 'Scannen', icon: <ScanLine />, group: '' }, NAV[4], NAV[2]];

export function Shell() {
  const { data: me } = useMe();
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  if (!me) return null;
  return (
    <div className="min-h-dvh lg:pl-64">
      <aside className="no-print fixed inset-y-0 left-0 hidden w-64 overflow-y-auto border-r border-line bg-canvas lg:block">
        <Sidebar me={me} />
      </aside>

      <header className="no-print sticky top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-canvas/90 px-4 backdrop-blur lg:hidden">
        <Logo />
        <button onClick={() => setMenu(true)} className="rounded-lg p-2 hover:bg-sunken" aria-label="Menü">
          <Menu className="size-5" />
        </button>
      </header>
      {menu && (
        <div className="fixed inset-0 z-50 bg-ink/30 lg:hidden" onClick={() => setMenu(false)}>
          <div className="animate-in h-full w-72 overflow-y-auto bg-canvas" onClick={(e) => e.stopPropagation()}>
            <Sidebar me={me} onNavigate={() => setMenu(false)} />
          </div>
        </div>
      )}

      <main key={loc.pathname} className="animate-in mx-auto max-w-6xl px-4 pt-6 pb-28 sm:px-6 lg:px-10 lg:pt-10 lg:pb-12">
        <Outlet />
      </main>

      <nav className="no-print fixed inset-x-0 bottom-0 z-30 grid grid-cols-5 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden">
        {MOBILE.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.to === '/'}
            className={({ isActive }) =>
              clsx('flex flex-col items-center gap-0.5 py-2 text-[11px] font-medium [&>svg]:size-5', isActive ? 'text-brand' : 'text-ink-3')
            }
          >
            {n.icon}
            {n.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}

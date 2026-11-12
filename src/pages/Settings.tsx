// Einstellungen: Sammelort für alles, was kein eigener Ort ist (docs/plan/v4.md 5) – Konto, Workspace-Verwaltung
// (Team, Subunternehmer, Import …) und Hilfe. Reiter der eigentlichen Einstellungen in der URL (?tab=…), Inhalte unter
// ./settings/; Team, Subunternehmer, Import und Hilfe sind Unterseiten (/einstellungen/team …) im selben Rahmen.
import clsx from 'clsx';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useMe } from '../api';
import { PageHeader, useUrlTab } from '../components/ui';
import { useOutbox } from '../offline';
import { AccountTab } from './settings/Account';
import { ActivityTab } from './settings/Activity';
import { ApiTab } from './settings/Api';
import { AutomationTab } from './settings/Automation';
import { CompanyTab } from './settings/Company';
import { NotificationsTab } from './settings/Notifications';
import { TasksTab } from './settings/Tasks';
import { TemplatesTab } from './settings/Templates';

// „privacy“ (früher eigener Reiter) zeigt jetzt das Konto – alte Links bleiben gültig.
const TABS = ['profile', 'privacy', 'notifications', 'company', 'templates', 'tasks', 'automation', 'api', 'activity'] as const;
type Tab = (typeof TABS)[number];
const ADMIN_ONLY: Tab[] = ['company', 'templates', 'tasks', 'automation', 'api'];
type Page = 'team' | 'subunternehmer' | 'import' | 'hilfe';

interface Item {
  key: Tab | Page | 'offline';
  label: string;
  to: string;
  admin?: boolean;
}
const GROUPS: { title: string; items: Item[] }[] = [
  {
    title: 'Du',
    items: [
      { key: 'profile', label: 'Konto', to: '/einstellungen' },
      { key: 'notifications', label: 'Benachrichtigungen', to: '/einstellungen?tab=notifications' },
      { key: 'activity', label: 'Aktivität', to: '/einstellungen?tab=activity' },
    ],
  },
  {
    title: 'Workspace',
    items: [
      { key: 'team', label: 'Team', to: '/einstellungen/team' },
      { key: 'subunternehmer', label: 'Subunternehmer', to: '/einstellungen/subunternehmer' },
      { key: 'company', label: 'Unternehmen', to: '/einstellungen?tab=company', admin: true },
      { key: 'templates', label: 'Prüfvorlagen', to: '/einstellungen?tab=templates', admin: true },
      { key: 'tasks', label: 'Aufgaben', to: '/einstellungen?tab=tasks', admin: true },
      { key: 'automation', label: 'Automatik', to: '/einstellungen?tab=automation', admin: true },
      { key: 'api', label: 'API', to: '/einstellungen?tab=api', admin: true },
      { key: 'import', label: 'Import', to: '/einstellungen/import' },
    ],
  },
  {
    title: 'Hilfe',
    items: [
      { key: 'offline', label: 'Offline-Modus', to: '/offline' },
      { key: 'hilfe', label: 'Anleitung & Hilfe', to: '/einstellungen/hilfe' },
    ],
  },
];

/**
 * Rahmen aller Einstellungsseiten: links (ab lg) die Bereiche als Text auf dem Grund, gruppiert; auf dem Handy
 * dieselben Bereiche als waagerecht scrollende Leiste über dem Inhalt. Die Einträge sind Reiter (role="tab").
 */
export function SettingsFrame({ current, children }: { current: Item['key']; children: ReactNode }) {
  const { data: me } = useMe();
  const outbox = useOutbox();
  const isAdmin = !!me && ['owner', 'admin'].includes(me.user.role);
  const canImport = me?.user.role !== 'viewer' && me?.user.canCreate !== false;
  const visible = (i: Item) => (!i.admin || isAdmin) && (i.key !== 'import' || canImport);
  const link = (i: Item, vertical: boolean) => {
    const active = i.key === current;
    return (
      <Link
        key={i.key}
        to={i.to}
        role="tab"
        aria-selected={active}
        className={clsx(
          'flex shrink-0 items-center gap-2 font-medium whitespace-nowrap transition-colors',
          vertical
            ? ['h-8 rounded-md px-2 text-body', active ? 'bg-selected text-ink' : 'text-ink-2 hover:bg-sunken/70 hover:text-ink']
            : ['relative h-11 text-body', active ? 'text-ink after:absolute after:inset-x-0 after:-bottom-px after:h-[1.5px] after:bg-ink' : 'text-ink-3 hover:text-ink-2'],
        )}
      >
        {i.label}
        {i.key === 'offline' && outbox.length > 0 && <span className="ml-auto text-meta font-normal text-ink-3 tabular-nums">{outbox.length}</span>}
      </Link>
    );
  };
  return (
    <div className="grid grid-cols-1 items-start gap-x-10 lg:grid-cols-[184px_minmax(0,1fr)]">
      {/* Handy und Tablet: eine Leiste */}
      <div role="tablist" aria-label="Einstellungen" className="no-scrollbar -mx-4 mb-6 flex gap-5 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0 lg:hidden">
        {GROUPS.flatMap((g) => g.items.filter(visible)).map((i) => link(i, false))}
      </div>
      {/* Desktop: Spalte auf dem Grund */}
      <nav aria-label="Einstellungen" className="hidden flex-col gap-5 pt-1 lg:flex">
        <p className="px-2 text-h3 font-semibold tracking-[-0.01em]">Einstellungen</p>
        {GROUPS.map((g) => (
          <div key={g.title} role="tablist" aria-orientation="vertical" aria-label={g.title} className="flex flex-col gap-px">
            <p className="mb-1 px-2 text-meta font-medium text-ink-3">{g.title}</p>
            {g.items.filter(visible).map((i) => link(i, true))}
          </div>
        ))}
      </nav>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function SettingsPage() {
  const { data: me } = useMe();
  const isAdmin = !!me && ['owner', 'admin'].includes(me.user.role);
  const [raw] = useUrlTab<Tab>('tab', 'profile', TABS);
  const tab: Tab = raw === 'privacy' || (!isAdmin && me && ADMIN_ONLY.includes(raw)) ? 'profile' : raw;
  const label = GROUPS.flatMap((g) => g.items).find((i) => i.key === tab)?.label;
  return (
    <SettingsFrame current={tab}>
      <PageHeader title={label ?? 'Einstellungen'} subtitle={me ? `${me.user.name} · ${me.tenant.name}` : undefined} className="lg:mb-6" />
      {tab === 'profile' && <AccountTab focus={raw === 'privacy' ? 'privacy' : undefined} />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'company' && isAdmin && <CompanyTab />}
      {tab === 'templates' && isAdmin && <TemplatesTab />}
      {tab === 'tasks' && isAdmin && <TasksTab />}
      {tab === 'automation' && isAdmin && <AutomationTab />}
      {tab === 'api' && isAdmin && <ApiTab />}
      {tab === 'activity' && <ActivityTab />}
    </SettingsFrame>
  );
}

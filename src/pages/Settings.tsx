// Einstellungen: Reiter in der URL (?tab=…), Inhalte je Reiter unter ./settings/
import { useMe } from '../api';
import { PageHeader, Tabs, useUrlTab } from '../components/ui';
import { AccountTab } from './settings/Account';
import { ActivityTab } from './settings/Activity';
import { ApiTab } from './settings/Api';
import { CompanyTab } from './settings/Company';
import { NotificationsTab } from './settings/Notifications';
import { TasksTab } from './settings/Tasks';
import { TemplatesTab } from './settings/Templates';

// „privacy“ (früher eigener Reiter) zeigt jetzt das Konto – alte Links bleiben gültig.
const TABS = ['profile', 'privacy', 'notifications', 'company', 'templates', 'tasks', 'api', 'activity'] as const;
type Tab = (typeof TABS)[number];

export function SettingsPage() {
  const { data: me } = useMe();
  const isAdmin = !!me && ['owner', 'admin'].includes(me.user.role);
  const [raw, setTab] = useUrlTab<Tab>('tab', 'profile', TABS);
  const adminOnly: Tab[] = ['company', 'templates', 'tasks', 'api'];
  const tab: Tab = raw === 'privacy' || (!isAdmin && me && adminOnly.includes(raw)) ? 'profile' : raw;
  const tabs: { value: Tab; label: string }[] = [
    { value: 'profile', label: 'Konto' },
    { value: 'notifications', label: 'Benachrichtigungen' },
    ...(isAdmin
      ? ([
          { value: 'company', label: 'Unternehmen' },
          { value: 'templates', label: 'Prüfvorlagen' },
          { value: 'tasks', label: 'Aufgaben' },
          { value: 'api', label: 'API' },
        ] as const)
      : []),
    { value: 'activity', label: 'Aktivität' },
  ];
  return (
    <>
      <PageHeader title="Einstellungen" subtitle={me ? `${me.user.name} · ${me.tenant.name}` : undefined} className="lg:mb-6" />
      <Tabs className="mb-8" value={tab} onChange={setTab} tabs={tabs} />
      {tab === 'profile' && <AccountTab focus={raw === 'privacy' ? 'privacy' : undefined} />}
      {tab === 'notifications' && <NotificationsTab />}
      {tab === 'company' && isAdmin && <CompanyTab />}
      {tab === 'templates' && isAdmin && <TemplatesTab />}
      {tab === 'tasks' && isAdmin && <TasksTab />}
      {tab === 'api' && isAdmin && <ApiTab />}
      {tab === 'activity' && <ActivityTab />}
    </>
  );
}

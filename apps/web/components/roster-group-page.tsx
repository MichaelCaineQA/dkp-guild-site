'use client';

import { can } from '@dkp/shared';
import { useSession } from './session-context';
import { RosterGroups } from './roster-groups';
import { Notice, Page, PageHeader, RosterTabs } from './ui';

export function RosterGroupPage({ mode }: { mode: 'kp' | 'pack' }) {
  const { user, loading } = useSession();
  if (loading) return <Page>Загрузка…</Page>;
  if (!user || (!user.memberId && !user.isAdmin))
    return (
      <Page>
        <PageHeader title="Состав гильдии" />
        <Notice>Раздел доступен членам гильдии после входа.</Notice>
      </Page>
    );
  return (
    <Page width="wide">
      <PageHeader title="Состав гильдии" />
      <RosterTabs
        current={mode}
        requests={can(user, 'link_requests.review')}
        blocked={can(user, 'members.manage')}
      />
      <RosterGroups user={user} mode={mode} />
    </Page>
  );
}

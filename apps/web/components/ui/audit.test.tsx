import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import { AuditFeed } from './audit';

it('показывает имя участника вместо ID и комментарий отдельной строкой', () => {
  render(
    <AuditFeed
      entries={[
        {
          id: 'log',
          actorMemberId: null,
          actorName: 'Админ',
          action: 'ROLE_CHANGE',
          entityType: 'Member',
          entityId: 'secret-member-id',
          entityName: 'Длинный ник игрока',
          comment: 'Передан новый ранг',
          createdAt: '2026-11-08T12:00:00.000Z',
        },
      ]}
    />,
  );
  expect(screen.getByText('Длинный ник игрока')).toBeDefined();
  expect(screen.getByText('Комментарий: Передан новый ранг')).toBeDefined();
  expect(screen.queryByText('secret-member-id')).toBeNull();
});

it('для удалённого участника использует безопасный fallback', () => {
  render(
    <AuditFeed
      entries={[
        {
          id: 'log',
          actorMemberId: null,
          actorName: null,
          action: 'MEMBER_DELETE',
          entityType: 'Member',
          entityId: 'deleted-id',
          entityName: 'Участник недоступен',
          comment: null,
          createdAt: '2026-11-08T12:00:00.000Z',
        },
      ]}
    />,
  );
  expect(screen.getByText('Участник недоступен')).toBeDefined();
  expect(screen.queryByText('deleted-id')).toBeNull();
});

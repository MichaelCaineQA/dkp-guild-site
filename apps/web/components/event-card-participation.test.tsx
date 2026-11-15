import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { EventCard } from './event-card';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
vi.mock('./session-context', () => ({ useSession: () => ({ user: { memberId: 'm' } }) }));
vi.mock('./checkin-panels', () => ({ CheckInPanel: () => null, RaidLeadCodePanel: () => null }));
vi.mock('./absent-members-panel', () => ({ AbsentMembersPanel: () => null }));

afterEach(cleanup);
it('после подачи и отмены отсутствия карточка обновляет порядок и прогресс группы', async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  let attending = true;
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path.endsWith('/participation') && options?.method === 'POST') {
      attending = JSON.parse(String(options.body)).attending;
      return { ok: true };
    }
    if (path.endsWith('/participation'))
      return {
        invited: true,
        attending,
        canDecline: true,
        canAttend: true,
        deadlineAt: '2030-01-01T00:00:00Z',
        absences: attending
          ? []
          : [
              {
                id: 'a',
                dateFrom: '2030-01-01T00:00:00Z',
                dateTo: '2030-01-01T01:00:00Z',
                reason: '',
              },
            ],
      };
    if (path.endsWith('/roster'))
      return [
        {
          id: 'm',
          nickname: 'Игрок',
          rank: 'MEMBER',
          weapons: ['STAFF', 'WAND'],
          combatRole: 'HEALER',
          kpId: 'k',
          kpName: 'КП',
          packId: 'p',
          packName: 'Пак',
          gearScore: null,
          attending,
        },
      ];
    throw new Error(`unexpected ${path}`);
  });
  const event = {
    id: 'e',
    name: 'Рейд',
    eventTypeName: 'Рейд',
    mode: 'PVE',
    status: 'PLANNED',
    startsAt: '2030-01-01T00:00:00Z',
    endsAt: '2030-01-01T01:00:00Z',
    scopeName: 'Гильдия',
    dkpReward: 10,
    raidLeadName: 'РЛ',
  };
  render(
    <EventCard
      event={event as never}
      gameTime={null}
      canManage={false}
      canConduct={false}
      onClose={() => {}}
      onChanged={() => {}}
      presentation="panel"
    />,
  );
  expect(await screen.findByText('КП — Будут 1 из 1')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Не буду' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Отправить' }));
  expect(await screen.findByText('КП — Будут 0 из 1')).toBeTruthy();
  fireEvent.click(await screen.findByRole('button', { name: 'Буду' }));
  fireEvent.click(screen.getByRole('button', { name: 'Отменить заявки и участвовать' }));
  expect(await screen.findByText('КП — Будут 1 из 1')).toBeTruthy();
});

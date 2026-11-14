import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RosterGroups } from './roster-groups';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
const user = {
  userId: 'u',
  username: 'Лидер',
  memberId: 'lead',
  rank: 'MEMBER' as const,
  isAdmin: false,
  blocked: false,
};
const groups = [
  {
    id: 'kp',
    name: 'Альфа',
    leaderId: 'lead',
    packs: [{ id: 'pack', name: 'Первый', kpId: 'kp', leaderId: null }],
  },
];
const member = {
  id: 'lead',
  nickname: 'Игрок',
  avatar: null,
  avatarColor: null,
  rank: 'MEMBER',
  combatRole: null,
  weapons: [],
  pack: {
    id: 'pack',
    name: 'Первый',
    leaderId: null,
    kp: { id: 'kp', name: 'Альфа', leaderId: 'lead' },
  },
  gearScore: 1234,
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api).mockImplementation(async (path) => ({
    groups,
    members: path.includes('?') ? [member] : [],
  }));
});
afterEach(cleanup);

it('показывает состав только после выбора КП и запрашивает данные выбранной КП', async () => {
  render(<RosterGroups user={user} mode="kp" />);
  expect(await screen.findByText(/Выберите КП, чтобы увидеть/)).toBeDefined();
  fireEvent.change(screen.getByLabelText('КП:'), { target: { value: 'kp' } });
  expect(await screen.findByText('Игрок')).toBeDefined();
  expect(screen.getByText('1234')).toBeDefined();
  await waitFor(() => expect(api).toHaveBeenCalledWith('/org/roster?kpId=kp'));
});

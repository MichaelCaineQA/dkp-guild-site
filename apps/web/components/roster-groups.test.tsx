import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
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

it('рядовой лидер сохраняет название своей КП', async () => {
  render(<RosterGroups user={user} mode="kp" />);
  fireEvent.change(await screen.findByLabelText('КП:'), { target: { value: 'kp' } });
  fireEvent.click(await screen.findByRole('button', { name: 'Изменить КП' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Название КП'), { target: { value: 'Новая КП' } });
  fireEvent.click(within(dialog).getByText('Сохранить'));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/org/kps/kp', {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Новая КП' }),
    }),
  );
});

it('офицер без назначения может выбрать КП при создании пака', async () => {
  render(<RosterGroups user={{ ...user, rank: 'OFFICER', memberId: 'officer' }} mode="pack" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Создать пак' }));
  const dialog = screen.getByRole('dialog');
  const kp = within(dialog).getByLabelText('КП') as HTMLSelectElement;
  expect(kp.disabled).toBe(false);
  fireEvent.change(kp, { target: { value: 'kp' } });
  fireEvent.change(within(dialog).getByLabelText('Название пака'), {
    target: { value: 'Новый пак' },
  });
  fireEvent.click(within(dialog).getByText('Принять'));
  await waitFor(() => {
    const request = vi.mocked(api).mock.calls.find(([path]) => path === '/org/packs')?.[1];
    expect(request?.method).toBe('POST');
    expect(JSON.parse(String(request?.body))).toEqual({
      kpId: 'kp',
      name: 'Новый пак',
      memberIds: [],
    });
  });
});

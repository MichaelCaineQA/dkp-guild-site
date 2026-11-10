import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LootLog } from './loot-log';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: vi.fn() }));

const members = [
  { id: 'm-1', nickname: 'Воин' },
  { id: 'm-2', nickname: 'Целитель' },
];
const events = [
  { id: 'e-1', name: 'Осада', startsAt: '2026-11-09T18:00:00.000Z' },
  { id: 'e-2', name: 'Поход', startsAt: '2026-11-10T18:00:00.000Z' },
];
const items = [{ id: 'i-1', name: 'Клинок зари' }];

const row = (over: Record<string, unknown> = {}) => ({
  awardId: 'w-1',
  lotId: 'a-1',
  itemName: 'Клинок зари',
  rarity: 'эпический',
  winnerId: 'm-1',
  winnerName: 'Воин',
  finalPrice: 225,
  markupPct: 50,
  eventId: 'e-1',
  eventName: 'Осада',
  eventStartsAt: '2026-11-09T18:00:00.000Z',
  createdAt: '2026-11-09T19:00:00.000Z',
  ...over,
});

beforeEach(() => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/members') return members;
    if (path === '/events') return events;
    if (path === '/items') return items;
    return { entries: [row()], total: 1 };
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('показывает выдачи: предмет, получатель, событие, стоимость с наценкой', async () => {
  render(<LootLog />);
  // ячейки, а не опции фильтров с теми же названиями
  expect(await screen.findByRole('cell', { name: /Клинок зари/ })).toBeDefined();
  expect(screen.getByRole('cell', { name: 'Воин' })).toBeDefined();
  expect(screen.getByRole('cell', { name: 'Осада' })).toBeDefined();
  expect(screen.getByText('225')).toBeDefined();
  expect(screen.getByText('+50%')).toBeDefined();
  // получатель — ссылка на профиль
  expect(screen.getByRole('link', { name: 'Воин' })).toHaveProperty(
    'href',
    expect.stringContaining('/profiles/m-1'),
  );
});

it('фильтр по игроку уходит в запрос, сброс возвращает все', async () => {
  render(<LootLog />);
  await screen.findByRole('cell', { name: /Клинок зари/ });

  fireEvent.change(screen.getByLabelText('Фильтр по игроку'), { target: { value: 'm-2' } });
  await waitFor(() => {
    expect(api).toHaveBeenLastCalledWith(
      expect.stringContaining('memberId=m-2'),
    );
  });

  fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
  await waitFor(() => {
    expect(api).toHaveBeenLastCalledWith(expect.not.stringContaining('memberId='));
  });
});

it('событие и предмет фильтруются вместе с игроком', async () => {
  render(<LootLog />);
  await screen.findByRole('cell', { name: /Клинок зари/ });

  fireEvent.change(screen.getByLabelText('Фильтр по событию'), { target: { value: 'e-2' } });
  fireEvent.change(screen.getByLabelText('Фильтр по предмету'), { target: { value: 'i-1' } });
  fireEvent.change(screen.getByLabelText('Фильтр по игроку'), { target: { value: 'm-1' } });
  await waitFor(() => {
    const call = vi.mocked(api).mock.calls.at(-1)?.[0] ?? '';
    expect(call).toContain('memberId=m-1');
    expect(call).toContain('eventId=e-2');
    expect(call).toContain('itemId=i-1');
  });
});

it('пустое состояние без фильтров и с фильтрами — разные подсказки', async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/members') return members;
    if (path === '/events') return events;
    if (path === '/items') return items;
    return { entries: [], total: 0 };
  });
  render(<LootLog />);
  expect(await screen.findByText(/Лута пока нет/)).toBeDefined();

  fireEvent.change(screen.getByLabelText('Фильтр по игроку'), { target: { value: 'm-2' } });
  expect(await screen.findByText('По этим фильтрам лута нет')).toBeDefined();
});

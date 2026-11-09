import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LootPanel } from './loot-panel';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: vi.fn() }));

const ITEM = {
  id: 'i-1',
  name: 'Клинок рассвета',
  rarity: 'Эпический',
  slot: 'Оружие',
  targetRoles: ['DPS', 'TANK'],
  defaultStartPrice: 120,
  lotsCount: 0,
};

const DEFAULTS = {
  startPrice: 120,
  step: 1,
  markupPct: 50,
  live: {
    durationValue: 1,
    durationUnit: 'MINUTES',
    antiSnipeSec: 30,
    antiSnipeExtendSec: 30,
    noBidTimeoutSec: 120,
  },
  long: { durationValue: 2, durationUnit: 'DAYS', antiSnipeSec: 600, antiSnipeExtendSec: 600 },
};

const DROP = {
  id: 'd-1',
  eventId: 'e-1',
  itemId: 'i-1',
  itemName: 'Клинок рассвета',
  rarity: 'Эпический',
  slot: 'Оружие',
  targetRoles: ['DPS', 'TANK'],
  createdAt: '2026-11-09T18:00:00.000Z',
  lot: null,
};

const LOT = {
  id: 'a-1',
  status: 'OPEN',
  startPrice: 120,
  step: 1,
  timerKind: 'FIRST_BID',
  durationSec: 60,
  antiSnipeSec: 30,
  antiSnipeExtendSec: 30,
  noBidTimeoutSec: 120,
  markupPct: 50,
  firstBidAt: null,
  endsAt: null,
  createdAt: '2026-11-09T18:05:00.000Z',
};

function mockApi(drops: unknown[] = [DROP], opts: { postOk?: boolean } = {}) {
  vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/items') return [ITEM];
    if (path === '/events/e-1/loot') return drops;
    if (path === '/events/e-1/loot/defaults/i-1') return DEFAULTS;
    if (path === '/events/e-1/loot/drops' && init?.method === 'POST') {
      if (opts.postOk === false) throw Object.assign(new Error('nope'), { status: 409 });
      return { ...DROP, id: 'd-2' };
    }
    if (path === '/events/e-1/loot/drops/d-1/lot' && init?.method === 'POST') return LOT;
    throw new Error(`unexpected ${path}`);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
});
afterEach(cleanup);

it('показывает дроп без лота и кнопку создания лота', async () => {
  mockApi();
  render(<LootPanel eventId="e-1" canEdit />);
  await screen.findByText('Клинок рассвета');
  expect(screen.getByText('Лот не создан')).toBeDefined();
  expect(screen.getByRole('button', { name: 'Создать лот' })).toBeDefined();
});

it('режим просмотра: без кнопок записи, список виден', async () => {
  mockApi([{ ...DROP, lot: LOT }]);
  render(<LootPanel eventId="e-1" canEdit={false} />);
  await screen.findByText('Клинок рассвета');
  expect(screen.queryByRole('button', { name: 'Зафиксировать дроп' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'Создать лот' })).toBeNull();
  expect(screen.getByText(/живая раздача 1 мин/)).toBeDefined();
});

it('фиксирует дроп выбранным предметом', async () => {
  mockApi([]);
  render(<LootPanel eventId="e-1" canEdit />);
  const select = await screen.findByLabelText('Предмет из справочника');
  fireEvent.change(select, { target: { value: 'i-1' } });
  fireEvent.click(screen.getByRole('button', { name: 'Зафиксировать дроп' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/events/e-1/loot/drops', {
      method: 'POST',
      body: JSON.stringify({ itemId: 'i-1' }),
    }),
  );
  await screen.findByText('Дроп зафиксирован');
});

it('создаёт живую раздачу с дефолтами настроек', async () => {
  mockApi();
  render(<LootPanel eventId="e-1" canEdit />);
  fireEvent.click(await screen.findByRole('button', { name: 'Создать лот' }));
  await screen.findByText('Новый лот: Клинок рассвета');
  const submit = screen.getAllByRole('button', { name: 'Создать лот' }).at(-1)!;
  fireEvent.click(submit);
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/events/e-1/loot/drops/d-1/lot', {
      method: 'POST',
      body: JSON.stringify({
        startPrice: 120,
        step: 1,
        timerKind: 'FIRST_BID',
        durationValue: 1,
        durationUnit: 'MINUTES',
        antiSnipeSec: 30,
        noBidTimeoutSec: 120,
      }),
    }),
  );
  await screen.findByText('Лот создан и открыт для ставок');
});

it('при переключении на длинный лот подставляет дни и убирает тайм-аут', async () => {
  mockApi();
  render(<LootPanel eventId="e-1" canEdit />);
  fireEvent.click(await screen.findByRole('button', { name: 'Создать лот' }));
  await screen.findByText('Новый лот: Клинок рассвета');
  fireEvent.change(screen.getByLabelText('Тип таймера'), { target: { value: 'OPENING' } });
  expect(screen.queryByText('Тайм-аут без ставок, сек')).toBeNull();
  const submit = screen.getAllByRole('button', { name: 'Создать лот' }).at(-1)!;
  fireEvent.click(submit);
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/events/e-1/loot/drops/d-1/lot', {
      method: 'POST',
      body: JSON.stringify({
        startPrice: 120,
        step: 1,
        timerKind: 'OPENING',
        durationValue: 2,
        durationUnit: 'DAYS',
        antiSnipeSec: 600,
        noBidTimeoutSec: undefined,
      }),
    }),
  );
});

it('некорректная длительность не уходит на сервер', async () => {
  mockApi();
  render(<LootPanel eventId="e-1" canEdit />);
  fireEvent.click(await screen.findByRole('button', { name: 'Создать лот' }));
  await screen.findByText('Новый лот: Клинок рассвета');
  const duration = screen.getByText('Длительность').querySelector('input')!;
  fireEvent.change(duration, { target: { value: '20' } });
  const submit = screen.getAllByRole('button', { name: 'Создать лот' }).at(-1)!;
  fireEvent.click(submit);
  await screen.findByText(/Длительность живой раздачи/);
  expect(api).not.toHaveBeenCalledWith(
    '/events/e-1/loot/drops/d-1/lot',
    expect.objectContaining({ method: 'POST' }),
  );
});

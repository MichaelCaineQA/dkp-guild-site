import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

/**
 * Гонка медленного CI (#116): модалка появляется вместе с form, но сабмит должен идти
 * только после подстановки дефолтов в поля — иначе POST не проходит валидацию,
 * а поздние дефолты могут перезаписать уже изменённое поле.
 */
async function lotFormReady() {
  await waitFor(() =>
    expect((screen.getByLabelText('Стартовая цена') as HTMLInputElement).value).toBe('120'),
  );
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
  // селект существует до загрузки /items: ждём опцию, иначе change не прилипнет (гонка на медленном CI, #116)
  await screen.findByText('Клинок рассвета (Эпический)');
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
  await lotFormReady();
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
  await lotFormReady();
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
  await lotFormReady();
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

describe('ручное управление лотом (issue #96)', () => {
  const OPEN_LOT = { ...LOT, timerKind: 'OPENING' as const, endsAt: '2026-11-11T20:00:00Z' };
  const MANAGE_OK = {
    lot: { ...OPEN_LOT },
    winner: { memberId: 'm-2', memberName: 'Целитель', finalPrice: 25, markupPct: 0 },
    refund: null,
    repeated: false,
  };
  let awardBody: Record<string, unknown> | null = null;
  let failAward: { message: string } | null = null;

  const mockManageApi = (drops: unknown[]) =>
    vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/events/e-1/loot') return drops;
      if (path === '/items') return [ITEM];
      if (path === '/members')
        return [
          { id: 'm-1', nickname: 'Воин' },
          { id: 'm-2', nickname: 'Целитель' },
        ];
      if (path === '/auctions/a-1/award') {
        if (failAward) throw { body: failAward };
        awardBody = JSON.parse(init!.body as string);
        return MANAGE_OK;
      }
      if (path === '/auctions/a-1/cancel') return { ...MANAGE_OK, winner: null };
      throw new Error(`unexpected ${path}`);
    });

  beforeEach(() => {
    awardBody = null;
    failAward = null;
    vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('управляющий видит продление и отмену, Глава — завершение и назначение', async () => {
    mockManageApi([{ ...DROP, lot: OPEN_LOT }]);
    render(<LootPanel eventId="e-1" canEdit={false} canManage canDecide />);
    expect(await screen.findByRole('button', { name: 'Продлить…' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Отменить…' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Завершить досрочно…' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Назначить победителя…' })).toBeDefined();
  });

  it('без прав действий нет — только параметры лота', async () => {
    mockManageApi([{ ...DROP, lot: OPEN_LOT }]);
    render(<LootPanel eventId="e-1" canEdit={false} />);
    await screen.findByText(/длинный лот/);
    expect(screen.queryByRole('button', { name: 'Продлить…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отменить…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Назначить победителя…' })).toBeNull();
  });

  it('завершённый лот — только назначение победителя, отменённый — только просмотр', async () => {
    mockManageApi([
      { ...DROP, lot: { ...OPEN_LOT, status: 'CLOSED' } },
      { ...DROP, id: 'd-2', lot: { ...OPEN_LOT, id: 'a-2', status: 'CANCELLED' } },
    ]);
    render(<LootPanel eventId="e-1" canEdit={false} canManage canDecide />);
    await screen.findByText(/Завершён/);
    expect(screen.getByRole('button', { name: 'Назначить победителя…' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Продлить…' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отменить…' })).toBeNull();
    expect(screen.getByText('Только просмотр')).toBeDefined();
  });

  it('назначение победителя: получатель, цена и причина уходят на сервер, итог показан', async () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    mockManageApi([{ ...DROP, lot: OPEN_LOT }]);
    render(<LootPanel eventId="e-1" canEdit={false} canManage canDecide />);
    fireEvent.click(await screen.findByRole('button', { name: 'Назначить победителя…' }));
    fireEvent.change(await screen.findByLabelText('Получатель'), { target: { value: 'm-2' } });
    fireEvent.change(screen.getByLabelText('Цена, ДКП (0 — бесплатно)'), {
      target: { value: '25' },
    });
    fireEvent.change(screen.getByLabelText('Причина (попадёт в аудит)'), {
      target: { value: 'договорились' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Назначить победителя' }));
    await waitFor(() => expect(screen.getByText(/Победитель: Целитель за 25 ДКП/)).toBeDefined());
    expect(awardBody).toMatchObject({
      winnerId: 'm-2',
      price: 25,
      comment: 'договорились',
      requestId: '00000000-0000-4000-8000-000000000001',
    });
    // Журнал ДКП изменился — виджеты балансов оповещены.
    expect(dispatchSpy).toHaveBeenCalledWith(new Event('dkp:changed'));
  });

  it('причина обязательна: пустая не уходит на сервер', async () => {
    mockManageApi([{ ...DROP, lot: OPEN_LOT }]);
    render(<LootPanel eventId="e-1" canEdit={false} canManage canDecide />);
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Отменить лот' }));
    await screen.findByText('Укажите причину действия');
    expect(api).not.toHaveBeenCalledWith('/auctions/a-1/cancel', expect.anything());
  });

  it('ошибка сервера показывается в модалке без потери введённого', async () => {
    mockManageApi([{ ...DROP, lot: OPEN_LOT }]);
    render(<LootPanel eventId="e-1" canEdit={false} canManage canDecide />);
    fireEvent.click(await screen.findByRole('button', { name: 'Назначить победителя…' }));
    fireEvent.change(await screen.findByLabelText('Получатель'), { target: { value: 'm-2' } });
    fireEvent.change(screen.getByLabelText('Причина (попадёт в аудит)'), {
      target: { value: 'причина' },
    });
    failAward = { message: 'Отменённый лот не меняется' };
    fireEvent.click(screen.getByRole('button', { name: 'Назначить победителя' }));
    await screen.findByText('Отменённый лот не меняется');
    expect((screen.getByLabelText('Причина (попадёт в аудит)') as HTMLInputElement).value).toBe(
      'причина',
    );
  });
});

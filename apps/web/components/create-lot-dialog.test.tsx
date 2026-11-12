import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreateLotDialog } from './create-lot-dialog';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: vi.fn() }));

const ITEMS = [
  {
    id: 'i-1',
    name: 'Клинок рассвета',
    rarity: 'Эпический',
    slot: 'Оружие',
    targetRoles: ['DPS', 'TANK'],
    defaultStartPrice: 120,
    lotsCount: 0,
  },
];

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

let posted: { path: string; body: unknown } | null = null;

function mockApi(opts: { fail?: boolean } = {}) {
  posted = null;
  vi.mocked(api).mockImplementation(async (path: string, init?: RequestInit) => {
    if (path === '/items') return ITEMS;
    if (path === '/auctions/lot-defaults/i-1') return DEFAULTS;
    if (path === '/auctions' && init?.method === 'POST') {
      if (opts.fail) throw Object.assign(new Error('nope'), { status: 400, body: { message: 'Предмет не найден' } });
      posted = { path, body: JSON.parse(String(init.body)) };
      return { id: 'a-9', status: 'OPEN' };
    }
    throw new Error(`unexpected ${path}`);
  });
}

/**
 * Гонка медленного CI (#116): поля формы — только после подстановки дефолтов.
 */
async function formReady() {
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

/** Ждём загрузку справочника — менять селект до опций нельзя (урок #116). */
async function optionsReady() {
  await screen.findByText(/Клинок рассвета/);
}

it('создаёт длинный лот по умолчанию: предмет из справочника, дефолты, POST /auctions', async () => {
  mockApi();
  const onCreated = vi.fn();
  render(<CreateLotDialog onClose={() => undefined} onCreated={onCreated} />);

  await optionsReady();
  fireEvent.change(screen.getByLabelText('Предмет из справочника'), {
    target: { value: 'i-1' },
  });
  await formReady();
  // дефолт для хранилища — длинный лот в днях
  expect((screen.getByLabelText('Тип таймера') as HTMLSelectElement).value).toBe('OPENING');

  fireEvent.click(screen.getByRole('button', { name: 'Создать лот' }));
  await waitFor(() => expect(posted).not.toBeNull());
  expect(posted!.body).toMatchObject({
    itemId: 'i-1',
    startPrice: 120,
    step: 1,
    timerKind: 'OPENING',
    durationValue: 2,
    durationUnit: 'DAYS',
    antiSnipeSec: 600,
  });
  expect(onCreated).toHaveBeenCalled();
});

it('переключение на живую раздачу подставляет live-дефолты и тайм-аут', async () => {
  mockApi();
  render(<CreateLotDialog onClose={() => undefined} onCreated={() => undefined} />);
  await optionsReady();
  fireEvent.change(screen.getByLabelText('Предмет из справочника'), {
    target: { value: 'i-1' },
  });
  await formReady();

  fireEvent.change(screen.getByLabelText('Тип таймера'), { target: { value: 'FIRST_BID' } });
  await waitFor(() =>
    expect((screen.getByLabelText('Тайм-аут без ставок, сек') as HTMLInputElement).value).toBe(
      '120',
    ),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Создать лот' }));
  await waitFor(() => expect(posted).not.toBeNull());
  expect(posted!.body).toMatchObject({
    timerKind: 'FIRST_BID',
    durationValue: 1,
    durationUnit: 'MINUTES',
    noBidTimeoutSec: 120,
  });
});

it('ошибка сервера показывается в модалке, ввод не теряется', async () => {
  mockApi({ fail: true });
  render(<CreateLotDialog onClose={() => undefined} onCreated={() => undefined} />);
  await optionsReady();
  fireEvent.change(screen.getByLabelText('Предмет из справочника'), {
    target: { value: 'i-1' },
  });
  await formReady();

  fireEvent.change(screen.getByLabelText('Стартовая цена'), { target: { value: '250' } });
  fireEvent.click(screen.getByRole('button', { name: 'Создать лот' }));
  expect(await screen.findByText('Предмет не найден')).toBeDefined();
  expect((screen.getByLabelText('Стартовая цена') as HTMLInputElement).value).toBe('250');
});

it('без предмета создать нельзя: кнопка задизейблена', async () => {
  mockApi();
  render(<CreateLotDialog onClose={() => undefined} onCreated={() => undefined} />);
  await optionsReady();
  expect(
    (screen.getByRole('button', { name: 'Создать лот' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

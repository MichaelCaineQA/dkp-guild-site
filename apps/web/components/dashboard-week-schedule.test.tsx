import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DashboardWeekSchedule } from './dashboard-week-schedule';
import { api } from '../lib/api';
import { getLocalWeekBounds, localDayKey, type WeekEvent } from '@dkp/shared';

vi.mock('../lib/api', () => ({ api: vi.fn() }));

// Среда 18 ноября 2026, локальное время — неделя 16–22 ноября.
const NOW = new Date(2026, 10, 18, 12, 0, 0);

function makeEvent(overrides: Partial<WeekEvent>): WeekEvent {
  return {
    scope: 'GUILD',
    kpId: null,
    packId: null,
    scopeName: 'Вся гильдия',
    id: 'e1',
    name: 'Гильдбосс',
    eventTypeId: 't1',
    eventTypeName: 'Гильдбосс',
    mode: 'PVE',
    status: 'PLANNED',
    startsAt: new Date(2026, 10, 16, 20, 0).toISOString(),
    endsAt: new Date(2026, 10, 16, 21, 30).toISOString(),
    dkpReward: 50,
    raidLeadId: 'rl',
    raidLeadName: 'Рейдлид',
    place: null,
    notes: null,
    invitedCount: 10,
    attendingCount: 8,
    canDecline: true,
    ...overrides,
  };
}

function requestedRange(call: unknown[] | undefined) {
  const path = String((call as [string])[0]);
  const params = new URLSearchParams(path.split('?')[1]);
  return { from: new Date(params.get('from')!), to: new Date(params.get('to')!) };
}

beforeEach(() => {
  vi.mocked(api).mockResolvedValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('показывает текущую неделю устройства: семь дней пн–вс, запрос с локальными границами', async () => {
  render(<DashboardWeekSchedule now={NOW} onSelect={() => {}} reloadSignal={0} />);
  expect(await screen.findByText('На этой неделе событий нет')).toBeDefined();
  for (const day of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']) {
    expect(screen.getByRole('group', { name: new RegExp(`^${day},`) })).toBeDefined();
  }
  expect(screen.getAllByText('Нет событий')).toHaveLength(7);
  const { from, to } = requestedRange(vi.mocked(api).mock.calls[0]);
  const expected = getLocalWeekBounds(NOW);
  expect(+from).toBe(+expected.start);
  expect(+to).toBe(+expected.end);
  // Кнопка возврата неактивна на текущей неделе.
  expect(
    (screen.getByRole('button', { name: 'Текущая неделя' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('плитка содержит только название, интервал времени и плату; клик открывает карточку', async () => {
  const onSelect = vi.fn();
  const event = makeEvent({});
  vi.mocked(api).mockResolvedValue([event]);
  render(<DashboardWeekSchedule now={NOW} onSelect={onSelect} reloadSignal={0} />);
  const tile = await screen.findByRole('button', { name: /Гильдбосс/ });
  expect(tile.textContent).toContain('20:00–21:30');
  expect(tile.textContent).toContain('50 ДКП');
  expect(tile.textContent).not.toContain('Рейдлид');
  expect(tile.textContent).not.toContain('PvE');
  expect(tile.textContent).not.toContain('8/10');
  fireEvent.click(tile);
  expect(onSelect).toHaveBeenCalledWith(event);
});

it('событие через полночь показывает дату окончания, прошедшее — приглушено', async () => {
  vi.mocked(api).mockResolvedValue([
    makeEvent({
      id: 'overnight',
      name: 'Ночной рейд',
      startsAt: new Date(2026, 10, 16, 23, 0).toISOString(),
      endsAt: new Date(2026, 10, 17, 1, 0).toISOString(),
    }),
    makeEvent({
      id: 'past',
      name: 'Утренний сбор',
      startsAt: new Date(2026, 10, 18, 9, 0).toISOString(),
      endsAt: new Date(2026, 10, 18, 10, 0).toISOString(),
    }),
  ]);
  render(<DashboardWeekSchedule now={NOW} onSelect={() => {}} reloadSignal={0} />);
  const overnight = await screen.findByRole('button', { name: /Ночной рейд/ });
  expect(overnight.textContent).toMatch(/23:00–01:00 \(17 .+\)/);
  // Событие с началом в понедельник не размножается на вторник.
  expect(screen.getAllByRole('button', { name: /Ночной рейд/ })).toHaveLength(1);
  const past = screen.getByRole('button', { name: /Утренний сбор/ });
  expect(past.className).toContain('opacity-50');
});

it('стрелки листают недели в прошлое и будущее, «Текущая неделя» возвращает', async () => {
  render(<DashboardWeekSchedule now={NOW} onSelect={() => {}} reloadSignal={0} />);
  await screen.findByText('На этой неделе событий нет');
  fireEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }));
  await screen.findByText('Загрузка…');
  await screen.findByText('На этой неделе событий нет');
  let range = requestedRange(vi.mocked(api).mock.calls.at(-1));
  expect(+range.from).toBe(+getLocalWeekBounds(new Date(2026, 10, 25)).start);
  fireEvent.click(screen.getByRole('button', { name: 'Предыдущая неделя' }));
  fireEvent.click(screen.getByRole('button', { name: 'Предыдущая неделя' }));
  await screen.findByText('На этой неделе событий нет');
  range = requestedRange(vi.mocked(api).mock.calls.at(-1));
  expect(+range.from).toBe(+getLocalWeekBounds(new Date(2026, 10, 9)).start);
  const back = screen.getByRole('button', { name: 'Текущая неделя' }) as HTMLButtonElement;
  expect(back.disabled).toBe(false);
  fireEvent.click(back);
  await screen.findByText('На этой неделе событий нет');
  range = requestedRange(vi.mocked(api).mock.calls.at(-1));
  expect(+range.from).toBe(+getLocalWeekBounds(NOW).start);
});

it('переход через месяц и год не ломает границы недели', async () => {
  // Воскресенье 3 января 2027 — неделя 28 декабря 2026 … 3 января 2027.
  render(
    <DashboardWeekSchedule now={new Date(2027, 0, 3, 12)} onSelect={() => {}} reloadSignal={0} />,
  );
  await screen.findByText('На этой неделе событий нет');
  const { from, to } = requestedRange(vi.mocked(api).mock.calls[0]);
  expect([from.getFullYear(), from.getMonth(), from.getDate()]).toEqual([2026, 11, 28]);
  expect([to.getFullYear(), to.getMonth(), to.getDate()]).toEqual([2027, 0, 4]);
  expect(screen.getByText(/28 дек\. 2026/)).toBeDefined();
  expect(screen.getByText(/3 янв\. 2027/)).toBeDefined();
});

it('ошибка загрузки показана явно и повторяется кнопкой, без подмены пустым расписанием', async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error('offline'));
  render(<DashboardWeekSchedule now={NOW} onSelect={() => {}} reloadSignal={0} />);
  expect(await screen.findByRole('alert')).toBeDefined();
  expect(screen.queryByText('На этой неделе событий нет')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Повторить загрузку' }));
  expect(await screen.findByText('На этой неделе событий нет')).toBeDefined();
  expect(vi.mocked(api)).toHaveBeenCalledTimes(2);
});

it('поздний ответ прошлого запроса не перезаписывает выбранную неделю', async () => {
  let resolveFirst: (events: WeekEvent[]) => void = () => {};
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise<WeekEvent[]>((resolve) => {
        resolveFirst = resolve;
      }),
  );
  vi.mocked(api).mockResolvedValue([
    makeEvent({
      id: 'next',
      name: 'Будущий ивент',
      startsAt: new Date(2026, 10, 24, 20, 0).toISOString(),
      endsAt: new Date(2026, 10, 24, 21, 0).toISOString(),
    }),
  ]);
  render(<DashboardWeekSchedule now={NOW} onSelect={() => {}} reloadSignal={0} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Следующая неделя' }));
  await screen.findByRole('button', { name: /Будущий ивент/ });
  // Старый запрос завершился позже — его данные не должны появиться.
  resolveFirst([makeEvent({ id: 'stale', name: 'Устаревший ответ' })]);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.queryByText('Устаревший ответ')).toBeNull();
  expect(screen.getByRole('button', { name: /Будущий ивент/ })).toBeDefined();
});

it('при переключении недели карточки прошлого периода сразу скрываются', async () => {
  vi.mocked(api).mockResolvedValue([makeEvent({})]);
  render(<DashboardWeekSchedule now={NOW} onSelect={() => {}} reloadSignal={0} />);
  await screen.findByRole('button', { name: /Гильдбосс/ });
  let resolveNext: (events: WeekEvent[]) => void = () => {};
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise<WeekEvent[]>((resolve) => {
        resolveNext = resolve;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Следующая неделя' }));
  expect(screen.queryByRole('button', { name: /Гильдбосс/ })).toBeNull();
  expect(screen.getByText('Загрузка…')).toBeDefined();
  resolveNext([]);
  await screen.findByText('На этой неделе событий нет');
});

it('события группируются по локальному дню начала', async () => {
  vi.mocked(api).mockResolvedValue([
    makeEvent({
      id: 'mon',
      name: 'Понедельник',
      startsAt: new Date(2026, 10, 16, 20, 0).toISOString(),
      endsAt: new Date(2026, 10, 16, 21, 0).toISOString(),
    }),
    makeEvent({
      id: 'fri',
      name: 'Пятница',
      startsAt: new Date(2026, 10, 20, 20, 0).toISOString(),
      endsAt: new Date(2026, 10, 20, 21, 0).toISOString(),
    }),
  ]);
  render(<DashboardWeekSchedule now={NOW} onSelect={() => {}} reloadSignal={0} />);
  const monday = await screen.findByRole('group', { name: /^Пн,/ });
  expect(monday.textContent).toContain('Понедельник');
  expect(monday.textContent).not.toContain('Пятница');
  const friday = screen.getByRole('group', { name: /^Пт,/ });
  expect(friday.textContent).toContain('Пятница');
  expect(screen.getByRole('group', { name: /^Вт,/ }).textContent).toContain('Нет событий');
});

it('смена reloadSignal перезагружает выбранную неделю', async () => {
  const { rerender } = render(
    <DashboardWeekSchedule now={NOW} onSelect={() => {}} reloadSignal={0} />,
  );
  await screen.findByText('На этой неделе событий нет');
  expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
  rerender(<DashboardWeekSchedule now={NOW} onSelect={() => {}} reloadSignal={1} />);
  await screen.findByText('На этой неделе событий нет');
  expect(vi.mocked(api)).toHaveBeenCalledTimes(2);
  const range = requestedRange(vi.mocked(api).mock.calls.at(-1));
  expect(localDayKey(range.from)).toBe(localDayKey(getLocalWeekBounds(NOW).start));
});

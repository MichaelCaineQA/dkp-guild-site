import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { StatisticsReport } from '@dkp/shared';
import { StatisticsScreen } from './statistics-screen';
import { baseReportFixture, NOW, statisticsApiMock } from './statistics-fixtures';
import { api } from '../lib/api';
import { useSession } from './session-context';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
vi.mock('./session-context', () => ({ useSession: vi.fn() }));

function session(
  user: {
    memberId: string | null;
    isAdmin?: boolean;
    rank?: 'GUILD_LEADER' | 'ADMIN' | 'OFFICER' | 'MEMBER';
  } | null,
) {
  vi.mocked(useSession).mockReturnValue({
    user: user
      ? {
          userId: 'u',
          username: 'Тест',
          memberId: user.memberId,
          rank: user.rank ?? 'MEMBER',
          isAdmin: user.isAdmin ?? false,
          blocked: false,
        }
      : null,
    loading: false,
    reload: vi.fn(),
  });
}

function emptyReport(): StatisticsReport {
  return baseReportFixture({ weeks: [], events: [] });
}

function reportWithEvent(): StatisticsReport {
  return baseReportFixture();
}

/** Ответы основы — очередь; профильные отчёты обзора — фикстуры. */
function mockApi(statistics: Array<Promise<StatisticsReport> | (() => Promise<StatisticsReport>)>) {
  const mock = statisticsApiMock({ base: statistics });
  vi.mocked(api).mockImplementation(mock.implementation as typeof api);
  return mock;
}

function statisticsCalls(): string[] {
  return vi
    .mocked(api)
    .mock.calls.filter(([path]) => typeof path === 'string' && path.startsWith('/statistics?'))
    .map(([path]) => String(path));
}

async function opened(statistics: Parameters<typeof mockApi>[0]) {
  mockApi(statistics);
  render(<StatisticsScreen now={NOW} />);
  await screen.findByText('Нет данных за выбранный период');
}

beforeEach(() => {
  vi.clearAllMocks();
  // Глубокая ссылка вкладки не должна протекать между тестами.
  window.history.replaceState(null, '', '/');
  session({ memberId: 'm1' });
});
afterEach(cleanup);

it('запрашивает текущий московский месяц и различает пустой период', async () => {
  await opened([Promise.resolve(emptyReport())]);
  expect(statisticsCalls()).toEqual(['/statistics?from=2026-12-01&to=2026-12-31']);
  // Условия периода видны в отчёте вместе с подписью часового пояса.
  expect(screen.getByText(/Период: 1 – 31 декабря 2026/)).toBeDefined();
  expect(screen.getAllByText(/По Москве, UTC\+3/).length).toBeGreaterThan(0);
  expect(screen.queryByText('По выбранным фильтрам ничего не найдено')).toBeNull();
});

it('пустой ответ с фильтрами — «ничего не найдено» со сбросом условий', async () => {
  await opened([
    Promise.resolve(emptyReport()),
    Promise.resolve(emptyReport()),
    Promise.resolve(emptyReport()),
  ]);
  await screen.findByText('Гильдбосс');
  fireEvent.change(screen.getByLabelText('Тип ивента:'), { target: { value: 't1' } });
  await screen.findByText('По выбранным фильтрам ничего не найдено');
  expect(statisticsCalls().at(-1)).toBe('/statistics?from=2026-12-01&to=2026-12-31&eventTypeId=t1');
  fireEvent.click(screen.getByRole('button', { name: 'Сбросить фильтры' }));
  await waitFor(() =>
    expect(statisticsCalls().at(-1)).toBe('/statistics?from=2026-12-01&to=2026-12-31'),
  );
  await screen.findByText('Нет данных за выбранный период');
});

it('ошибка запроса не превращается в нули и повторяется', async () => {
  mockApi([Promise.reject(new Error('offline')), Promise.resolve(emptyReport())]);
  render(<StatisticsScreen now={NOW} />);
  expect(await screen.findByRole('alert')).toBeDefined();
  expect(screen.getByText('Не удалось загрузить отчёт')).toBeDefined();
  expect(screen.queryByText('Нет данных за выбранный период')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  await screen.findByText('Нет данных за выбранный период');
});

it('поздний ответ старого запроса не заменяет новый отчёт', async () => {
  let resolveFirst: (report: StatisticsReport) => void = () => {};
  const hanging = new Promise<StatisticsReport>((resolve) => {
    resolveFirst = resolve;
  });
  mockApi([hanging, Promise.resolve(emptyReport())]);
  render(<StatisticsScreen now={NOW} />);
  // Пока первый запрос висит, меняем фильтр — второй запрос отвечает пустым отчётом.
  await screen.findByText('Гильдбосс');
  fireEvent.change(screen.getByLabelText('Тип ивента:'), { target: { value: 't1' } });
  await screen.findByText('По выбранным фильтрам ничего не найдено');
  resolveFirst(reportWithEvent());
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(screen.getByText('По выбранным фильтрам ничего не найдено')).toBeDefined();
});

it('смена условий скрывает прошлые данные состоянием обновления', async () => {
  mockApi([Promise.resolve(reportWithEvent()), Promise.resolve(emptyReport())]);
  render(<StatisticsScreen now={NOW} />);
  // Обзор с данными основы открывает карточки и профильные отчёты.
  expect(await screen.findByText('Активные участники')).toBeDefined();
  fireEvent.change(screen.getByLabelText('Режим:'), { target: { value: 'PVE' } });
  // Старое содержимое скрыто, показан каркас обновления, затем пустой отчёт
  // с активным фильтром режима — это «ничего не найдено», не «нет данных».
  expect(screen.queryByText('Активные участники')).toBeNull();
  await screen.findByRole('status');
  await screen.findByText('По выбранным фильтрам ничего не найдено');
  expect(statisticsCalls().at(-1)).toBe('/statistics?from=2026-12-01&to=2026-12-31&mode=PVE');
});

it('вкладки переключаются стрелками и клавиатурой, условия общие для всех', async () => {
  mockApi([Promise.resolve(reportWithEvent()), Promise.resolve(reportWithEvent())]);
  render(<StatisticsScreen now={NOW} />);
  await screen.findByText('Активные участники');
  const tabs = ['Обзор', 'Посещаемость', 'Активность', 'ДКП', 'Лут'];
  for (const label of tabs) {
    expect(screen.getByRole('tab', { name: label })).toBeDefined();
  }
  expect(screen.getByRole('tab', { name: 'Обзор' }).getAttribute('aria-selected')).toBe('true');
  // Выбранный тип ивента виден в применённых условиях и сохраняется между вкладками.
  fireEvent.change(screen.getByLabelText('Тип ивента:'), { target: { value: 't1' } });
  await screen.findByText(/Тип ивента: Гильдбосс/);
  fireEvent.click(screen.getByRole('tab', { name: 'ДКП' }));
  const panel = screen.getByRole('tabpanel');
  expect(panel.getAttribute('aria-labelledby')).toBe('tab-dkp');
  expect(screen.getByText(/Тип ивента: Гильдбосс/)).toBeDefined();
  // Клавиатура: стрелка вправо от «ДКП» выбирает «Лут».
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowRight' });
  expect(screen.getByRole('tab', { name: 'Лут' }).getAttribute('aria-selected')).toBe('true');
  fireEvent.keyDown(screen.getByRole('tablist'), { key: 'ArrowLeft' });
  expect(screen.getByRole('tab', { name: 'ДКП' }).getAttribute('aria-selected')).toBe('true');
});

it('глубокая ссылка открывает вкладку периода', async () => {
  window.history.replaceState(null, '', '/statistics?tab=loot');
  await opened([Promise.resolve(emptyReport())]);
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('tab-loot');
  window.history.replaceState(null, '', '/');
});

it('переход из обзора открывает вкладку с чипом среза; срез снимается', async () => {
  mockApi([Promise.resolve(reportWithEvent())]);
  render(<StatisticsScreen now={NOW} />);
  await screen.findByText('Активные участники');
  fireEvent.click(screen.getByRole('button', { name: /Посещаемость Игрок Один/ }));
  expect(screen.getByRole('tabpanel').getAttribute('aria-labelledby')).toBe('tab-attendance');
  expect(screen.getByText('Игрок: Игрок Один')).toBeDefined();
  fireEvent.click(screen.getByRole('button', { name: /Снять срез/ }));
  expect(screen.queryByText('Игрок: Игрок Один')).toBeNull();
  // Смена общих фильтров тоже снимает срез: возвращаемся на обзор и открываем заново.
  fireEvent.click(screen.getByRole('tab', { name: 'Обзор' }));
  await screen.findByRole('button', { name: /Посещаемость Игрок Один/ });
  fireEvent.click(screen.getByRole('button', { name: /Посещаемость Игрок Один/ }));
  await screen.findByText('Игрок: Игрок Один');
  fireEvent.change(screen.getByLabelText('Режим:'), { target: { value: 'PVE' } });
  expect(screen.queryByText('Игрок: Игрок Один')).toBeNull();
});

it('свежесть GS на обзоре запрашивает только Глава/Админ', async () => {
  const memberMock = mockApi([Promise.resolve(reportWithEvent())]);
  render(<StatisticsScreen now={NOW} />);
  await screen.findByText('Активные участники');
  expect(memberMock.paths('/statistics/gear-score')).toEqual([]);
  expect(screen.queryByText('Свежесть GS')).toBeNull();
});

it('Глава видит блок свежести GS на обзоре', async () => {
  session({ memberId: 'm1', rank: 'GUILD_LEADER' });
  mockApi([Promise.resolve(reportWithEvent())]);
  render(<StatisticsScreen now={NOW} />);
  expect(await screen.findByText('Актуальные: 3')).toBeDefined();
});

it('пустой период скрывает отчёты, но Глава видит срез GS и экспорт (#253)', async () => {
  session({ memberId: 'm1', rank: 'GUILD_LEADER' });
  const mock = mockApi([Promise.resolve(emptyReport())]);
  render(<StatisticsScreen now={NOW} />);
  expect(await screen.findByText('Актуальные: 3')).toBeDefined();
  expect(screen.getByRole('button', { name: 'Скачать CSV: свежесть GS' })).toBeDefined();
  expect(screen.getByText('Нет данных за выбранный период')).toBeDefined();
  expect(screen.queryByText('Активные участники')).toBeNull();
  expect(mock.paths('/statistics/gear-score').length).toBeGreaterThan(0);
  expect(mock.paths('/statistics/attendance')).toEqual([]);
});

it('без входа и без привязки аккаунта — пояснения вместо отчёта', () => {
  session(null);
  const { rerender } = render(<StatisticsScreen now={NOW} />);
  expect(screen.getByText('Раздел доступен членам гильдии после входа.')).toBeDefined();
  expect(vi.mocked(api)).not.toHaveBeenCalled();
  session({ memberId: null });
  rerender(<StatisticsScreen now={NOW} />);
  expect(screen.getByText(/отправьте заявку на привязку ника/)).toBeDefined();
});

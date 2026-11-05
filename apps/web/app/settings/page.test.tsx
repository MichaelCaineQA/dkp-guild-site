import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SettingsPage from './page';

/** Мокаем api-клиент и сессию: экран настроек — чистый UI над /settings. */
vi.mock('../../lib/api', () => ({
  api: vi.fn(),
}));

vi.mock('../../components/session-context', () => ({
  useSession: vi.fn(),
}));

const { api } = await import('../../lib/api');
const { useSession } = await import('../../components/session-context');

function mockSession(user: Record<string, unknown> | null) {
  vi.mocked(useSession).mockReturnValue({
    user: user as never,
    loading: false,
    reload: vi.fn(),
  });
}

const SETTINGS_FIXTURE = {
  'checkin.generateBeforeStartSec': 180,
  'checkin.windowSec': 180,
  'checkin.attempts': 1,
  'checkin.startSharePct': 50,
  'checkin.endSharePct': 50,
  'absence.deadlineBeforeStartSec': 180,
  'auction.step': 1,
  'auction.liveDurationSec': 60,
  'auction.longDurationDays': 2,
  'auction.antiSnipeLiveSec': 30,
  'auction.antiSnipeLongSec': 600,
  'auction.foreignClassMarkupPct': 50,
  'auction.noBidTimeoutSec': 120,
};

const GAME_TIME_FIXTURE = {
  gameTimeAnchor: '2026-01-01T00:00:00.000Z',
  gameTimeDayMinutes: 90,
  gameTimeNightMinutes: 30,
};

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(api).mockImplementation(async (path: string) => {
      if (path === '/settings') {
        return { ...SETTINGS_FIXTURE };
      }
      if (path === '/settings/game-time') {
        return { ...GAME_TIME_FIXTURE };
      }
      if (path === '/event-types') {
        return [
          { id: 't-1', name: 'Гильдбосс' },
          { id: 't-2', name: 'Осада' },
        ];
      }
      throw new Error(`unexpected path ${path}`);
    });
  });

  // jsdom-документ общий на файл — без отмонтирования рендеры соседних
  // тестов наложатся и queryByText найдёт чужие элементы.
  afterEach(() => {
    cleanup();
  });

  it('глава видит настройки (все группы + игровой цикл) и справочник типов', async () => {
    mockSession({
      userId: 'u1',
      username: 'test-leader',
      memberId: 'm1',
      rank: 'GUILD_LEADER',
      isAdmin: false,
    });

    render(<SettingsPage />);

    expect(await screen.findByText('Настройки системы')).toBeDefined();
    expect(screen.getByText('Чек-ин кодами (план 2.2)')).toBeDefined();
    expect(screen.getByText('Аукцион (план 6)')).toBeDefined();
    expect(screen.getByText('Игровой цикл (план 2.1)')).toBeDefined();
    expect(screen.getByText('Окно выбора кода')).toBeDefined();
    expect(screen.getByText('Наценка «чужому» классу')).toBeDefined();
    expect(screen.getByText('Сохранить настройки')).toBeDefined();
    expect(screen.getByText('Типы ивентов')).toBeDefined();
    // Названия типов в полях ввода (canEdit=true) — проверяем по значению.
    expect(screen.getByDisplayValue('Гильдбосс')).toBeDefined();
    expect(screen.getByDisplayValue('Осада')).toBeDefined();
    expect(screen.getByText('Добавить')).toBeDefined();
  });

  it('офицер видит справочник с кнопками, но настройки — только для чтения', async () => {
    mockSession({
      userId: 'u2',
      username: 'test-officer',
      memberId: 'm2',
      rank: 'OFFICER',
      isAdmin: false,
    });

    render(<SettingsPage />);

    expect(await screen.findByText('Настройки системы')).toBeDefined();
    expect(screen.getByText('Изменение — только Глава и Админ.')).toBeDefined();
    expect(screen.queryByText('Сохранить настройки')).toBeNull();
    expect(screen.getByText('Типы ивентов')).toBeDefined();
    expect(screen.getAllByText('Переименовать').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Удалить').length).toBeGreaterThan(0);
    // Инпуты значений настроек заблокированы для офицера.
    const numberInputs = screen
      .getAllByRole('spinbutton')
      .filter((input) => (input as HTMLInputElement).disabled);
    expect(numberInputs.length).toBeGreaterThan(0);
  });

  it('рядовому — заглушка офицеров и выше', async () => {
    mockSession({
      userId: 'u3',
      username: 'test-member',
      memberId: 'm3',
      rank: 'MEMBER',
      isAdmin: false,
    });

    render(<SettingsPage />);

    expect(await screen.findByText('Раздел доступен офицерам и выше.')).toBeDefined();
    expect(api).not.toHaveBeenCalled();
  });
});

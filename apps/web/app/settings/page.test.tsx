import { cleanup, fireEvent, render, screen } from '@testing-library/react';
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
    expect(screen.getByText('Чек-ин')).toBeDefined();
    expect(screen.getByText('Аукцион')).toBeDefined();
    expect(screen.getByText('Игровой цикл')).toBeDefined();
    expect(screen.getByLabelText('Окно выбора кода, сек')).toBeDefined();
    expect(screen.getByLabelText('Наценка «чужому» классу, %')).toBeDefined();
    expect(screen.queryByText('Сохранить')).toBeNull();
    expect(screen.getByText('Типы ивентов')).toBeDefined();
    // Названия типов в полях ввода (canEdit=true) — проверяем по значению.
    expect(screen.getByDisplayValue('Гильдбосс')).toBeDefined();
    expect(screen.getByDisplayValue('Осада')).toBeDefined();
    expect(screen.getByText('Добавить')).toBeDefined();
  });

  it('офицеру настройки недоступны, запросов нет', async () => {
    mockSession({
      userId: 'u2',
      username: 'test-officer',
      memberId: 'm2',
      rank: 'OFFICER',
      isAdmin: false,
    });
    render(<SettingsPage />);
    expect(await screen.findByText('Раздел доступен Главе и Админу.')).toBeDefined();
    expect(api).not.toHaveBeenCalled();
  });

  it('рядовому — заглушка Главы и Админа', async () => {
    mockSession({
      userId: 'u3',
      username: 'test-member',
      memberId: 'm3',
      rank: 'MEMBER',
      isAdmin: false,
    });

    render(<SettingsPage />);

    expect(await screen.findByText('Раздел доступен Главе и Админу.')).toBeDefined();
    expect(api).not.toHaveBeenCalled();
  });
  it('ошибка добавления типа сохраняет введённое название', async () => {
    mockSession({
      userId: 'u',
      username: 'Глава',
      memberId: 'head',
      rank: 'GUILD_LEADER',
      isAdmin: false,
    });
    const original = vi.mocked(api).getMockImplementation()!;
    vi.mocked(api).mockImplementation(async (path, init) => {
      if (init?.method === 'POST') throw { status: 409 };
      return original(path, init);
    });
    render(<SettingsPage />);
    await screen.findByText('Настройки системы');
    const input = screen.getByPlaceholderText('Новый тип ивента') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'Новый сбор' } });
    fireEvent.submit(input.closest('form')!);
    await screen.findByText('Конфликт: такое название уже есть');
    expect(input.value).toBe('Новый сбор');
  });
});

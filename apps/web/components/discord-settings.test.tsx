import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { DiscordSettings } from './discord-settings';

vi.mock('../lib/api', () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('сохраняет канал и подтверждение доступа к отсутствиям', async () => {
  vi.mocked(api).mockResolvedValue({
    configured: true,
    channels: { announcements: null, reminders: null, absences: null, lots: null },
  });
  render(<DiscordSettings />);
  fireEvent.change(await screen.findByLabelText('Заявки об отсутствии'), {
    target: { value: '401' },
  });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.change(screen.getByLabelText('Причина изменения'), {
    target: { value: 'Новый канал' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить каналы' }));
  await waitFor(() =>
    expect(vi.mocked(api)).toHaveBeenCalledWith(
      '/settings/discord',
      expect.objectContaining({
        method: 'PUT',
        body: expect.stringContaining('"absenceAccessConfirmed":true'),
      }),
    ),
  );
});

it('показывает ошибку Discord и сохраняет введённый канал', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce({
      configured: true,
      channels: { announcements: null, reminders: null, absences: null, lots: null },
    })
    .mockRejectedValueOnce({ body: { message: 'Боту не хватает прав' } });
  render(<DiscordSettings />);
  const channel = (await screen.findByLabelText('Анонсы ивентов')) as HTMLInputElement;
  fireEvent.change(channel, { target: { value: '400' } });
  fireEvent.change(screen.getByLabelText('Причина изменения'), { target: { value: 'Настройка' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить каналы' }));
  expect(await screen.findByText('Боту не хватает прав')).toBeDefined();
  expect(channel.value).toBe('400');
});

const emptyChannels = { announcements: null, reminders: null, absences: null, lots: null };
/** Кнопки проверки — в порядке полей: анонсы, напоминания, отсутствия, лоты. */
const testButton = (index: number) =>
  screen.getAllByRole('button', { name: 'Проверить сохранённый канал' })[
    index
  ] as HTMLButtonElement;
const testCalls = () =>
  vi.mocked(api).mock.calls.filter(([path]) => path.startsWith('/settings/discord/test/'));
const HINT = 'Проверить можно только сохранённый канал. Сначала сохраните каналы.';

it('проверка недоступна, пока введённый канал не сохранён (#315)', async () => {
  vi.mocked(api).mockResolvedValue({ configured: true, channels: emptyChannels });
  render(<DiscordSettings />);
  fireEvent.change(await screen.findByLabelText('Заявки об отсутствии'), {
    target: { value: '401' },
  });

  expect(testButton(2).disabled).toBe(true);
  expect(await screen.findByText(HINT)).toBeDefined();
  fireEvent.click(testButton(2));
  expect(testCalls()).toEqual([]);
});

it('после сохранения введённого канала проверка доступна и уходит в Discord', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce({ configured: true, channels: emptyChannels })
    .mockResolvedValueOnce({ configured: true, channels: { ...emptyChannels, absences: '401' } })
    .mockResolvedValueOnce({ id: 'test-1' });
  render(<DiscordSettings />);
  fireEvent.change(await screen.findByLabelText('Заявки об отсутствии'), {
    target: { value: '401' },
  });
  fireEvent.change(screen.getByLabelText('Причина изменения'), {
    target: { value: 'Новый канал' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить каналы' }));

  await waitFor(() => expect(testButton(2).disabled).toBe(false));
  expect(screen.queryByText(HINT)).toBeNull();
  fireEvent.click(testButton(2));
  await waitFor(() =>
    expect(vi.mocked(api)).toHaveBeenCalledWith('/settings/discord/test/absences', {
      method: 'POST',
    }),
  );
});

it('при смене сохранённого ID без сохранения проверка ждёт сохранения', async () => {
  vi.mocked(api).mockResolvedValue({
    configured: true,
    channels: { ...emptyChannels, reminders: '111' },
  });
  render(<DiscordSettings />);
  const channel = await screen.findByLabelText('Напоминания');
  expect(testButton(1).disabled).toBe(false);

  fireEvent.change(channel, { target: { value: '222' } });
  expect(testButton(1).disabled).toBe(true);
  expect(screen.getByText(HINT)).toBeDefined();

  fireEvent.change(channel, { target: { value: '111' } });
  expect(testButton(1).disabled).toBe(false);
  expect(screen.queryByText(HINT)).toBeNull();
});

it('«Канал не настроен» при несохранённых правках — с подсказкой сохранить (#315)', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce({
      configured: true,
      channels: { ...emptyChannels, reminders: '111' },
    })
    .mockRejectedValueOnce({ body: { message: 'Канал не настроен' } });
  render(<DiscordSettings />);
  await screen.findByLabelText('Напоминания');
  fireEvent.change(screen.getByLabelText('Анонсы ивентов'), { target: { value: '400' } });
  fireEvent.click(testButton(1));

  expect(await screen.findByText('Канал не настроен. Сначала сохраните каналы')).toBeDefined();
});

it('«Канал не настроен» без несохранённых правок показывается как есть', async () => {
  vi.mocked(api)
    .mockResolvedValueOnce({
      configured: true,
      channels: { ...emptyChannels, reminders: '111' },
    })
    .mockRejectedValueOnce({ body: { message: 'Канал не настроен' } });
  render(<DiscordSettings />);
  await screen.findByLabelText('Напоминания');
  fireEvent.click(testButton(1));

  expect(await screen.findByText('Канал не настроен')).toBeDefined();
  expect(screen.queryByText(/Сначала сохраните каналы/)).toBeNull();
});

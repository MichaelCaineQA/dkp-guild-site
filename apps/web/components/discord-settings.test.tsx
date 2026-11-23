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

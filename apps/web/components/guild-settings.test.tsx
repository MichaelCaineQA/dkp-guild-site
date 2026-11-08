import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GuildSettings } from './guild-settings';
import { api } from '../lib/api';
vi.mock('../lib/api', () => ({ api: vi.fn(), API_URL_VALUE: '/api' }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it('сохраняет название и обновляет общую шапку', async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === '/meta/guild'
      ? { name: 'Старое', hasCrest: false }
      : { name: 'Новое', hasCrest: false },
  );
  const changed = vi.fn();
  window.addEventListener('guild:changed', changed);
  render(<GuildSettings />);
  const name = await screen.findByLabelText('Название гильдии');
  await waitFor(() => expect((name as HTMLInputElement).value).toBe('Старое'));
  fireEvent.change(name, { target: { value: 'Новое' } });
  fireEvent.click(screen.getByRole('button', { name: 'Сохранить гильдию' }));
  expect(await screen.findByText('Настройки гильдии сохранены')).toBeDefined();
  expect(changed).toHaveBeenCalledTimes(1);
  window.removeEventListener('guild:changed', changed);
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import LinkPage from './page';
import { api } from '../../lib/api';
vi.mock('../../lib/api', () => ({ api: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it('анкета предлагает 8 RU-оружий и отправляет роль и выбранную пару', async () => {
  vi.mocked(api).mockResolvedValue({ ok: true });
  render(<LinkPage />);
  expect(screen.getByLabelText('Первое оружие').querySelectorAll('option')).toHaveLength(9);
  expect(screen.queryByText('Сфера')).toBeNull();
  expect(screen.queryByText('Перчатки')).toBeNull();
  fireEvent.change(screen.getByPlaceholderText('Игровой ник'), { target: { value: 'Игрок' } });
  fireEvent.change(screen.getByLabelText('Роль'), { target: { value: 'HEALER' } });
  fireEvent.change(screen.getByLabelText('Первое оружие'), { target: { value: 'STAFF' } });
  expect(
    (
      screen
        .getByLabelText('Второе оружие')
        .querySelector('option[value="STAFF"]') as HTMLOptionElement
    ).disabled,
  ).toBe(true);
  fireEvent.change(screen.getByLabelText('Второе оружие'), { target: { value: 'WAND' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отправить заявку' }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith('/auth/link-request', {
      method: 'POST',
      body: JSON.stringify({ nickname: 'Игрок', combatRole: 'HEALER', weapons: ['STAFF', 'WAND'] }),
    }),
  );
});

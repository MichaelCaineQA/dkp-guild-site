import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import LinkPage from './page';
import { api } from '../../lib/api';
const reload = vi.fn();
vi.mock('../../lib/api', () => ({ api: vi.fn(), API_URL_VALUE: 'http://localhost:3001' }));
vi.mock('../../components/session-context', () => ({ useSession: () => ({ reload }) }));
const id = '11111111-1111-4111-8111-111111111111';
const pending = {
  id: 'r',
  nickname: 'Игрок',
  combatRole: 'HEALER',
  weapons: ['STAFF', 'WAND'],
  gearScore: 1,
  screenshotIds: [id],
};
beforeEach(() => {
  vi.mocked(api).mockResolvedValue({ request: null });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
async function fields() {
  await screen.findByLabelText('Игровой ник');
  fireEvent.change(screen.getByLabelText('Игровой ник'), { target: { value: 'Игрок' } });
  fireEvent.change(screen.getByLabelText('Роль в бою'), { target: { value: 'HEALER' } });
  fireEvent.change(screen.getByLabelText('Первое оружие'), { target: { value: 'STAFF' } });
  fireEvent.change(screen.getByLabelText('Второе оружие'), { target: { value: 'WAND' } });
}
it('предлагает 8 RU-оружий и не отправляет анкету без GS и скрина', async () => {
  render(<LinkPage />);
  await fields();
  expect(screen.getByLabelText('Первое оружие').querySelectorAll('option')).toHaveLength(9);
  expect(screen.queryByText('Сфера')).toBeNull();
  expect(screen.queryByText('Перчатки')).toBeNull();
  fireEvent.submit(screen.getByRole('button', { name: 'Отправить анкету' }).closest('form')!);
  expect(screen.getByRole('alert').textContent).toContain('положительный целый GS');
  expect(api).toHaveBeenCalledTimes(1);
});
it('загружает скриншот и отправляет обязательные поля, затем показывает ожидание', async () => {
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === '/screenshots') return { id };
    if (options?.method === 'POST') return { ok: true };
    return {
      request: vi
        .mocked(api)
        .mock.calls.some(([, init]) => init?.method === 'POST' && typeof init.body === 'string')
        ? pending
        : null,
    };
  });
  render(<LinkPage />);
  await fields();
  fireEvent.change(screen.getByLabelText('GS'), { target: { value: '1' } });
  fireEvent.change(screen.getByLabelText('Скриншоты профиля'), {
    target: { files: [new File(['png'], 'gs.png', { type: 'image/png' })] },
  });
  await screen.findByText('Скриншот 1');
  await waitFor(() => expect(screen.queryByText('Загрузка скриншотов…')).toBeNull());
  fireEvent.submit(screen.getByRole('button', { name: 'Отправить анкету' }).closest('form')!);
  await screen.findByText('Ожидание одобрения');
  expect(api).toHaveBeenCalledWith('/auth/link-request', {
    method: 'POST',
    body: JSON.stringify({
      nickname: 'Игрок',
      combatRole: 'HEALER',
      weapons: ['STAFF', 'WAND'],
      gearScore: 1,
      screenshotIds: [id],
    }),
  });
});
it('после перезагрузки показывает ожидающую анкету и позволяет редактировать её', async () => {
  vi.mocked(api).mockResolvedValue({ request: pending });
  render(<LinkPage />);
  await screen.findByText('Ожидание одобрения');
  fireEvent.click(screen.getByText('Редактировать анкету'));
  expect((screen.getByLabelText('Игровой ник') as HTMLInputElement).value).toBe('Игрок');
  expect((screen.getByLabelText('GS') as HTMLInputElement).value).toBe('1');
  expect(screen.getByText('Скриншот 1')).toBeDefined();
});
it('проверка одобрения обновляет сессию', async () => {
  vi.mocked(api).mockResolvedValue({ request: pending });
  render(<LinkPage />);
  await screen.findByText('Ожидание одобрения');
  fireEvent.click(screen.getByText('Проверить одобрение'));
  await waitFor(() => expect(reload).toHaveBeenCalled());
});
it('браузер не отправляет неподдерживаемый файл', async () => {
  render(<LinkPage />);
  await fields();
  fireEvent.change(screen.getByLabelText('Скриншоты профиля'), {
    target: { files: [new File(['svg'], 'gs.svg', { type: 'image/svg+xml' })] },
  });
  expect(screen.getByRole('alert').textContent).toContain('до 10 МБ');
  expect(api).toHaveBeenCalledTimes(1);
});

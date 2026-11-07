import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeclineEventDialog, EventParticipation } from './event-participation';
import { api } from '../lib/api';
vi.mock('../lib/api', () => ({ api: vi.fn() }));
const state = {
  invited: true,
  attending: true,
  canDecline: true,
  canAttend: true,
  deadlineAt: '2027-02-09T16:57:00Z',
  absences: [],
};
beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  vi.mocked(api).mockImplementation(async (_path, options) =>
    options?.method === 'POST' ? { ok: true } : state,
  );
});
afterEach(cleanup);
describe('Моё участие', () => {
  it('необязательная причина: отправка без текста и обновление списка', async () => {
    const onChanged = vi.fn();
    const onClose = vi.fn();
    render(<DeclineEventDialog eventId="e" onChanged={onChanged} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Отправить' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/events/e/participation', {
        method: 'POST',
        body: JSON.stringify({ attending: false, reason: '' }),
      }),
    );
    expect(onChanged).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
  it('ошибка сохраняет введённую причину и не закрывает форму', async () => {
    const onClose = vi.fn();
    vi.mocked(api).mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') throw { status: 409 };
      return state;
    });
    render(<DeclineEventDialog eventId="e" onChanged={vi.fn()} onClose={onClose} />);
    const reason = await screen.findByLabelText('Причина (необязательно)');
    fireEvent.change(reason, { target: { value: 'Работа' } });
    fireEvent.click(screen.getByRole('button', { name: 'Отправить' }));
    await screen.findByText(/Участие изменилось или срок истёк/);
    expect((reason as HTMLInputElement).value).toBe('Работа');
    expect(onClose).not.toHaveBeenCalled();
  });
  it('недоступные действия скрыты', async () => {
    vi.mocked(api).mockResolvedValue({ ...state, canDecline: false, canAttend: false });
    render(<EventParticipation eventId="e" onChanged={vi.fn()} />);
    await screen.findByText('Буду');
    expect(screen.queryByRole('button', { name: 'Не буду' })).toBeNull();
  });
  it('возвращение сначала показывает периоды; отправляет только после подтверждения их ID', async () => {
    const absent = {
      ...state,
      attending: false,
      absences: [
        {
          id: 'a',
          dateFrom: '2027-02-08T00:00:00Z',
          dateTo: '2027-02-10T23:59:59Z',
          reason: 'Отпуск',
        },
      ],
    };
    vi.mocked(api).mockImplementation(async (_path, options) =>
      options?.method === 'POST' ? { ok: true } : absent,
    );
    render(<EventParticipation eventId="e" onChanged={vi.fn()} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Буду' }));
    expect(screen.getByText(/Будут целиком отменены/)).toBeDefined();
    expect(screen.getByText(/Отпуск/)).toBeDefined();
    expect(
      vi.mocked(api).mock.calls.filter(([, options]) => options?.method === 'POST'),
    ).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Отменить заявки и участвовать' }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith('/events/e/participation', {
        method: 'POST',
        body: JSON.stringify({ attending: true, absenceIds: ['a'] }),
      }),
    );
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CreateEventDialog } from './create-event-dialog';
import { api } from '../lib/api';

vi.mock('../lib/api', () => ({ api: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  vi.mocked(api).mockImplementation(async (path) => {
    if (path === '/event-types') return [{ id: 'type-1', name: 'Гильдбосс' }];
    if (path === '/members') return [{ id: 'member-1', nickname: 'Рейд-лид' }];
    return { created: 4 };
  });
});
afterEach(cleanup);

async function fillForm() {
  await screen.findByRole('option', { name: 'Гильдбосс' });
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Создать' }).hasAttribute('disabled')).toBe(false),
  );
  fireEvent.change(screen.getByLabelText('Тип ивента'), { target: { value: 'type-1' } });
  fireEvent.change(screen.getByLabelText('Рейд-лид'), { target: { value: 'member-1' } });
  fireEvent.change(screen.getByLabelText('Начало'), { target: { value: '2026-11-10T20:00' } });
  fireEvent.change(screen.getByLabelText('Плата ДКП'), { target: { value: '10' } });
}

describe('создание ивента', () => {
  it('отправляет местное время в UTC и сообщает об успешном создании', async () => {
    const onCreated = vi.fn();
    render(<CreateEventDialog series={false} onClose={vi.fn()} onCreated={onCreated} />);
    await fillForm();
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    const call = vi.mocked(api).mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(call[0]).toBe('/events');
    const body = JSON.parse(call[1]!.body as string);
    expect(body.startsAt).toBe(new Date('2026-11-10T20:00').toISOString());
    expect(new Date(body.endsAt).getTime() - new Date(body.startsAt).getTime()).toBe(3_600_000);
    expect(body.dkpReward).toBe(10);
    expect(body.raidLeadId).toBe('member-1');
  });

  it('предпросмотр серии совпадает с параметрами отправки, день старта включён', async () => {
    render(<CreateEventDialog series onClose={vi.fn()} onCreated={vi.fn()} />);
    await fillForm();
    fireEvent.change(screen.getByLabelText('Количество недель'), { target: { value: '2' } });
    fireEvent.click(screen.getByLabelText('Чт'));
    expect(screen.getByText('Будет создано ивентов: 4')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/events/series', expect.anything()));
    const call = vi.mocked(api).mock.calls.find(([path]) => path === '/events/series')!;
    const body = JSON.parse(call[1]!.body as string);
    expect(body.weeks).toBe(2);
    expect(body.weekdays).toContain(new Date(body.startsAt).getUTCDay());
  });

  it('сохраняет форму при ошибке API и блокирует повторную отправку в процессе', async () => {
    const onCreated = vi.fn();
    render(<CreateEventDialog series={false} onClose={vi.fn()} onCreated={onCreated} />);
    await fillForm();
    let rejectRequest!: (reason: unknown) => void;
    vi.mocked(api).mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          rejectRequest = reject;
        }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Создать' }));
    expect(screen.getByRole('button', { name: 'Сохранение…' }).hasAttribute('disabled')).toBe(true);
    rejectRequest({ status: 403 });
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'Нет прав на создание ивентов.',
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect((screen.getByLabelText('Плата ДКП') as HTMLInputElement).value).toBe('10');
  });
});

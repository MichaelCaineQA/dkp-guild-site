import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GearScoreEditor } from './gear-score-editor';
import { api } from '../lib/api';
vi.mock('../lib/api', () => ({ api: vi.fn(), API_URL_VALUE: '/api' }));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
describe('Обновление GS', () => {
  it('не отправляет GS без скриншота', async () => {
    render(<GearScoreEditor memberId="m1" onSaved={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Новое значение GS'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить GS' }));
    expect(await screen.findByText(/Укажите положительный целый GS/)).toBeDefined();
    expect(api).not.toHaveBeenCalled();
  });
  it('сохраняет значение со своим загруженным файлом и обновляет профиль', async () => {
    const id = '11111111-1111-4111-8111-111111111111';
    vi.mocked(api).mockResolvedValueOnce({ id }).mockResolvedValueOnce({ ok: true });
    const onSaved = vi.fn().mockResolvedValue(undefined);
    render(<GearScoreEditor memberId="m1" onSaved={onSaved} />);
    fireEvent.change(screen.getByLabelText('Скриншоты с ником и GS'), {
      target: { files: [new File(['png'], 'gs.png', { type: 'image/png' })] },
    });
    await screen.findByText('Скриншот 1');
    await waitFor(() =>
      expect((screen.getByLabelText('Новое значение GS') as HTMLInputElement).disabled).toBe(false),
    );
    fireEvent.change(screen.getByLabelText('Новое значение GS'), { target: { value: '5000' } });
    fireEvent.change(screen.getByLabelText('Причина обновления GS'), {
      target: { value: 'Новая экипировка' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить GS' }));
    expect(await screen.findByText('GS обновлён')).toBeDefined();
    expect(api).toHaveBeenLastCalledWith('/profiles/m1/gear-score', {
      method: 'POST',
      body: JSON.stringify({ gearScore: 5000, screenshotIds: [id], comment: 'Новая экипировка' }),
    });
    expect(onSaved).toHaveBeenCalledOnce();
  });
});

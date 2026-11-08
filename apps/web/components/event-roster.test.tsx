import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { EventRoster } from './event-roster';
vi.mock('../lib/api', () => ({ api: vi.fn() }));

describe('Состав события', () => {
  beforeEach(() => vi.resetAllMocks());
  afterEach(cleanup);
  it('показывает состав и сворачивает группы со счётчиками', async () => {
    vi.mocked(api).mockResolvedValue([
      {
        id: 'a',
        nickname: 'Игрок',
        rank: 'MEMBER',
        weapons: ['STAFF', 'WAND'],
        combatRole: 'HEALER',
        kpId: 'k',
        kpName: 'КП',
        packId: 'p',
        packName: 'Пак',
        gearScore: 3000,
        attending: false,
      },
    ]);
    render(<EventRoster eventId="e" />);
    expect(await screen.findByText('Игрок')).toBeTruthy();
    expect(screen.getByText('КП — Будут 0 из 1')).toBeTruthy();
    expect(screen.getByText(/GS 3000/)).toBeTruthy();
    fireEvent.click(screen.getByText('КП — Будут 0 из 1'));
    expect(screen.getByText('КП — Будут 0 из 1').closest('details')?.open).toBe(false);
  });
  it('сообщает об ошибке загрузки', async () => {
    vi.mocked(api).mockRejectedValue(new Error('ошибка'));
    render(<EventRoster eventId="e" />);
    expect(await screen.findByText('Не удалось загрузить состав')).toBeTruthy();
  });
  it('сначала показывает идущих по нику и считает прогресс', async () => {
    const base = {
      rank: 'MEMBER',
      weapons: ['STAFF', 'WAND'],
      combatRole: 'HEALER',
      kpId: 'k',
      kpName: 'КП',
      packId: 'p',
      packName: 'Пак',
      gearScore: null,
    };
    vi.mocked(api).mockResolvedValue([
      { ...base, id: '1', nickname: 'Аня', attending: false },
      { ...base, id: '2', nickname: 'Яна', attending: true },
      { ...base, id: '3', nickname: 'Борис', attending: true },
    ]);
    render(<EventRoster eventId="e" />);
    await screen.findByText('Борис');
    expect(screen.getAllByRole('progressbar').map((p) => p.getAttribute('value'))).toEqual([
      '2',
      '2',
    ]);
    expect(
      [...document.querySelectorAll('li')].map((li) =>
        li.querySelector('a')?.getAttribute('aria-label'),
      ),
    ).toEqual(['Профиль: Борис', 'Профиль: Яна', 'Профиль: Аня']);
  });
});

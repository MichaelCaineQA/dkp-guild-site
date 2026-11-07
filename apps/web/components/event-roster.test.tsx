import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '../lib/api';
import { EventRoster } from './event-roster';
vi.mock('../lib/api', () => ({ api: vi.fn() }));

describe('Состав события', () => {
  beforeEach(() => vi.resetAllMocks());
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
    expect(screen.getByText('КП — 0/1')).toBeTruthy();
    expect(screen.getByText(/GS 3000/)).toBeTruthy();
    fireEvent.click(screen.getByText('КП — 0/1'));
    expect(screen.getByText('КП — 0/1').closest('details')?.open).toBe(false);
  });
  it('сообщает об ошибке загрузки', async () => {
    vi.mocked(api).mockRejectedValue(new Error('ошибка'));
    render(<EventRoster eventId="e" />);
    expect(await screen.findByText('Не удалось загрузить состав')).toBeTruthy();
  });
});

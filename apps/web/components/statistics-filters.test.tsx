import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  StatisticsFilters,
  defaultStatisticsFilters,
  hasActiveStatisticsFilters,
  statisticsFilterQuery,
  type StatisticsFilterOptions,
} from './statistics-filters';

afterEach(cleanup);

const OPTIONS: StatisticsFilterOptions = {
  kps: [
    {
      id: 'kp1',
      name: 'КП Альфа',
      packs: [
        { id: 'p1', name: 'Пак Один' },
        { id: 'p2', name: 'Пак Два' },
      ],
    },
    { id: 'kp2', name: 'КП Бета', packs: [{ id: 'p3', name: 'Пак Три' }] },
  ],
  eventTypes: [{ id: 't1', name: 'Гильдбосс' }],
};

function mount(now: Date, value = defaultStatisticsFilters(now)) {
  const onChange = vi.fn();
  const view = render(
    <StatisticsFilters now={now} options={OPTIONS} value={value} onChange={onChange} />,
  );
  return { onChange, view };
}

// 30 ноября 23:00 UTC: в Москве уже 1 декабря, в зонах позади UTC — ещё 30 ноября.
const MOSCOW_NEW_MONTH = new Date('2026-11-30T23:00:00Z');

describe('период по умолчанию — текущий месяц Москвы', () => {
  it('месяц границы не зависят от часовой зоны браузера', () => {
    const { from, to } = defaultStatisticsFilters(MOSCOW_NEW_MONTH);
    expect([from, to]).toEqual(['2026-12-01', '2026-12-31']);
  });

  it('панель показывает московский месяц и подпись часового пояса', () => {
    mount(MOSCOW_NEW_MONTH);
    expect((screen.getByLabelText('Месяц:') as HTMLInputElement).value).toBe('2026-12');
    expect(screen.getByText(/По Москве, UTC\+3/)).toBeDefined();
  });

  it('сброс возвращает текущий месяц и снимает фильтры', () => {
    const now = MOSCOW_NEW_MONTH;
    const value = {
      ...defaultStatisticsFilters(now),
      month: '2026-01',
      kpId: 'kp1',
      packId: 'p1',
      eventTypeId: 't1',
      mode: 'PVP' as const,
    };
    const { onChange } = mount(now, value);
    fireEvent.click(screen.getByRole('button', { name: 'Сбросить' }));
    expect(onChange).toHaveBeenCalledWith(defaultStatisticsFilters(now));
  });
});

describe('совместимость КП и пака', () => {
  it('несовместимый с новой КП пак сбрасывается с видимым изменением', () => {
    const now = new Date('2026-12-05T12:00:00Z');
    const value = { ...defaultStatisticsFilters(now), kpId: 'kp1', packId: 'p2' };
    const { onChange } = mount(now, value);
    fireEvent.change(screen.getByLabelText('КП:'), { target: { value: 'kp2' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kpId: 'kp2', packId: '' }));
  });

  it('пак совместимой КП сохраняется, возврат к «все КП» его не сбрасывает', () => {
    const now = new Date('2026-12-05T12:00:00Z');
    const { onChange } = mount(now, {
      ...defaultStatisticsFilters(now),
      kpId: 'kp1',
      packId: 'p1',
    });
    const packs = screen.getByLabelText('Пак:') as HTMLSelectElement;
    expect([...packs.options].map((option) => option.value)).toEqual(['', 'p1', 'p2']);
    fireEvent.change(screen.getByLabelText('КП:'), { target: { value: '' } });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ kpId: '', packId: 'p1' }));
  });

  it('без выбранной КП список паков общий для всех КП', () => {
    const now = new Date('2026-12-05T12:00:00Z');
    mount(now, { ...defaultStatisticsFilters(now), kpId: '' });
    const packs = screen.getByLabelText('Пак:') as HTMLSelectElement;
    expect([...packs.options].map((option) => option.value)).toEqual(['', 'p1', 'p2', 'p3']);
  });
});

describe('контекст запроса', () => {
  const base = defaultStatisticsFilters(new Date('2026-12-05T12:00:00Z'));

  it('месяц разворачивается во включительные границы', () => {
    expect(statisticsFilterQuery({ ...base, month: '2026-02' })).toEqual({
      from: '2026-02-01',
      to: '2026-02-28',
      kpId: undefined,
      packId: undefined,
      eventTypeId: undefined,
      mode: undefined,
    });
  });

  it('перевёрнутый или неполный диапазон не образует период', () => {
    expect(
      statisticsFilterQuery({ ...base, periodKind: 'range', from: '2026-12-10', to: '2026-12-01' }),
    ).toBeNull();
    expect(
      statisticsFilterQuery({ ...base, periodKind: 'range', from: '', to: '2026-12-31' }),
    ).toBeNull();
    expect(statisticsFilterQuery({ ...base, month: '' })).toBeNull();
  });

  it('признак активных фильтров отличает пустой период от отсутствия совпадений', () => {
    expect(hasActiveStatisticsFilters(base)).toBe(false);
    expect(hasActiveStatisticsFilters({ ...base, eventTypeId: 't1', mode: 'PVE' })).toBe(true);
  });

  it('перевёрнутый диапазон объясняется ошибкой в панели', () => {
    mount(new Date('2026-12-05T12:00:00Z'), {
      ...base,
      periodKind: 'range',
      from: '2026-12-10',
      to: '2026-12-01',
    });
    expect(screen.getByText('Начало периода должно быть не позднее окончания')).toBeDefined();
  });
});

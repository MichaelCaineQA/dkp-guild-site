'use client';

import { moscowMonthBounds, type StatisticsQuery } from '@dkp/shared';
import { Button, Card, ErrorText, Field, Input, Muted, SectionTitle, Select } from './ui';

/**
 * Общая панель периода и фильтров статистики (план 2.8): один контекст
 * для всех вкладок и экспорта. Границы — календарные даты по Москве;
 * дефолт — текущий московский месяц, часовая зона браузера на него
 * не влияет.
 */

export interface StatisticsFilterOptions {
  kps: { id: string; name: string; packs: { id: string; name: string }[] }[];
  eventTypes: { id: string; name: string }[];
}

export interface StatisticsFilterState {
  periodKind: 'month' | 'range';
  /** 'YYYY-MM' при periodKind='month'. */
  month: string;
  /** 'YYYY-MM-DD' при periodKind='range'. */
  from: string;
  to: string;
  kpId: string;
  packId: string;
  eventTypeId: string;
  mode: '' | 'PVE' | 'PVP';
}

/** Текущий московский месяц без фильтров — состояние «Сбросить». */
export function defaultStatisticsFilters(now: Date): StatisticsFilterState {
  const { from, to } = moscowMonthBounds(now);
  return {
    periodKind: 'month',
    month: from.slice(0, 7),
    from,
    to,
    kpId: '',
    packId: '',
    eventTypeId: '',
    mode: '',
  };
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

function monthRange(month: string): { from: string; to: string } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex = Number(match[2]) - 1;
  if (monthIndex < 0 || monthIndex > 11) return null;
  const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const pad = (value: number) => String(value).padStart(2, '0');
  return {
    from: `${year}-${pad(monthIndex + 1)}-01`,
    to: `${year}-${pad(monthIndex + 1)}-${pad(lastDay)}`,
  };
}

/**
 * Валидный общий контекст контрактов #212 или null, пока черновой ввод
 * не образует период: экран не запрашивает отчёт под неприменимыми датами.
 * Границы периода в валидном контексте всегда заданы явно.
 */
export function statisticsFilterQuery(
  state: StatisticsFilterState,
): (StatisticsQuery & { from: string; to: string }) | null {
  const range =
    state.periodKind === 'month' ? monthRange(state.month) : { from: state.from, to: state.to };
  if (!range || !isCalendarDate(range.from) || !isCalendarDate(range.to)) return null;
  if (range.from > range.to) return null;
  return {
    from: range.from,
    to: range.to,
    kpId: state.kpId || undefined,
    packId: state.packId || undefined,
    eventTypeId: state.eventTypeId || undefined,
    mode: state.mode || undefined,
  };
}

export function hasActiveStatisticsFilters(state: StatisticsFilterState): boolean {
  return !!(state.kpId || state.packId || state.eventTypeId || state.mode);
}

function periodError(state: StatisticsFilterState): string | null {
  if (state.periodKind === 'month') {
    return monthRange(state.month) ? null : 'Укажите месяц периода';
  }
  if (!state.from || !state.to) return 'Укажите обе границы периода';
  if (!isCalendarDate(state.from) || !isCalendarDate(state.to)) {
    return 'Укажите корректные даты периода';
  }
  if (state.from > state.to) return 'Начало периода должно быть не позднее окончания';
  return null;
}

export function StatisticsFilters({
  now,
  options,
  value,
  onChange,
}: {
  now: Date;
  options: StatisticsFilterOptions | null;
  value: StatisticsFilterState;
  onChange: (next: StatisticsFilterState) => void;
}) {
  const set = (patch: Partial<StatisticsFilterState>) => onChange({ ...value, ...patch });
  // Список паков согласован с выбранной КП; несовместимый выбор сбрасывается.
  const setKp = (kpId: string) => {
    const packs = kpId ? (options?.kps.find((kp) => kp.id === kpId)?.packs ?? []) : null;
    const keepPack =
      !value.packId || (packs ? packs.some((pack) => pack.id === value.packId) : true);
    onChange({ ...value, kpId, packId: keepPack ? value.packId : '' });
  };
  const packs = value.kpId
    ? (options?.kps.find((kp) => kp.id === value.kpId)?.packs ?? [])
    : (options?.kps.flatMap((kp) => kp.packs) ?? []);
  const error = periodError(value);
  return (
    <Card className="mb-4">
      <SectionTitle>Период и фильтры</SectionTitle>
      <div className="flex flex-wrap items-center gap-3">
        <Field label="Период:">
          <Select
            value={value.periodKind}
            onChange={(e) =>
              set({ periodKind: e.target.value as StatisticsFilterState['periodKind'] })
            }
          >
            <option value="month">Месяц</option>
            <option value="range">Точные даты</option>
          </Select>
        </Field>
        {value.periodKind === 'month' ? (
          <Field label="Месяц:">
            <Input
              type="month"
              value={value.month}
              onChange={(e) => set({ month: e.target.value })}
            />
          </Field>
        ) : (
          <>
            <Field label="С:">
              <Input
                type="date"
                value={value.from}
                onChange={(e) => set({ from: e.target.value })}
              />
            </Field>
            <Field label="По:">
              <Input type="date" value={value.to} onChange={(e) => set({ to: e.target.value })} />
            </Field>
          </>
        )}
        {/* Конечная дата включена; границы периода — календарные дни Москвы. */}
        <Muted>По Москве, UTC+3, правая граница включена</Muted>
      </div>
      {error && <ErrorText>{error}</ErrorText>}
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Field label="КП:">
          <Select value={value.kpId} onChange={(e) => setKp(e.target.value)}>
            <option value="">все</option>
            {options?.kps.map((kp) => (
              <option key={kp.id} value={kp.id}>
                {kp.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Пак:">
          <Select value={value.packId} onChange={(e) => set({ packId: e.target.value })}>
            <option value="">все</option>
            {packs.map((pack) => (
              <option key={pack.id} value={pack.id}>
                {pack.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Тип ивента:">
          <Select value={value.eventTypeId} onChange={(e) => set({ eventTypeId: e.target.value })}>
            <option value="">все</option>
            {options?.eventTypes.map((type) => (
              <option key={type.id} value={type.id}>
                {type.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Режим:">
          <Select
            value={value.mode}
            onChange={(e) => set({ mode: e.target.value as StatisticsFilterState['mode'] })}
          >
            <option value="">любой</option>
            <option value="PVE">PvE</option>
            <option value="PVP">PvP</option>
          </Select>
        </Field>
        <Button onClick={() => onChange(defaultStatisticsFilters(now))}>Сбросить</Button>
      </div>
    </Card>
  );
}

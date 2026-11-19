/**
 * Навигация внутри статистики (#219–#222): вкладки и дополнительные срезы.
 * Срез — локальное условие поверх общих фильтров (неделя графика, игрок
 * топа, тип ивента), полученное переходом; виден чипом и снимается кнопкой,
 * не меняя общую панель фильтров.
 */

import { moscowWeekLabel, statisticsQueryString, type StatisticsQuery } from '@dkp/shared';

export type StatisticsTab = 'overview' | 'attendance' | 'activity' | 'dkp' | 'loot';

/**
 * Путь CSV-выгрузки таблицы (#223): общие условия запроса плюс параметры
 * конкретной таблицы. endpoint='' — обзорные таблицы (/statistics/export.csv).
 */
export function csvPath(
  endpoint: '' | 'attendance' | 'activity' | 'dkp' | 'loot',
  params: Record<string, string>,
  query: StatisticsQuery,
): string {
  const base = endpoint ? `/statistics/${endpoint}/export.csv` : '/statistics/export.csv';
  const extra = Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join('&');
  const qs = statisticsQueryString(query);
  return `${base}?${[qs, extra].filter(Boolean).join('&')}`;
}
export type StatisticsFocus =
  /** Неделя графика: детализация тех дат в посещаемости. */
  | { kind: 'week'; start: string; end: string }
  /** Игрок топа обзора: раскрытая строка посещаемости. */
  | { kind: 'attendanceMember'; memberId: string; nickname: string }
  /** Таблица вкладки «Активность» после карточек обзора. */
  | { kind: 'activityTable'; table: 'members' | 'events' }
  /** Тип ивента из таблицы типов обзора. */
  | { kind: 'activityType'; eventTypeId: string; name: string }
  /** Показатель ДКП из карточки обзора. */
  | { kind: 'dkpSection'; section: 'earned' | 'spent' | 'adjustments' }
  /** Представление лута из топа обзора. */
  | { kind: 'lootView'; view: 'dropped' | 'awarded' }
  /** Предмет топа лута: раскрытая строка «Выпало». */
  | { kind: 'lootItem'; itemId: string; name: string };

export function statisticsFocusLabel(focus: StatisticsFocus): string {
  switch (focus.kind) {
    case 'week':
      return `Неделя: ${moscowWeekLabel(focus.start, focus.end)}`;
    case 'attendanceMember':
      return `Игрок: ${focus.nickname}`;
    case 'activityTable':
      return focus.table === 'members' ? 'Таблица игроков' : 'Таблица ивентов';
    case 'activityType':
      return `Тип ивента: ${focus.name}`;
    case 'dkpSection':
      return focus.section === 'earned'
        ? 'Начисления'
        : focus.section === 'spent'
          ? 'Траты на аукционах'
          : 'Корректировки';
    case 'lootView':
      return focus.view === 'dropped' ? 'Выпало' : 'Получено';
    case 'lootItem':
      return `Предмет: ${focus.name}`;
  }
}

export function isSameStatisticsFocus(
  a: StatisticsFocus | null,
  b: StatisticsFocus | null,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

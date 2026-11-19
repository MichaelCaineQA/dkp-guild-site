/**
 * Навигация внутри статистики (#219–#222): вкладки и дополнительные срезы.
 * Срез — локальное условие поверх общих фильтров (неделя графика, игрок
 * топа, тип ивента), полученное переходом; виден чипом и снимается кнопкой,
 * не меняя общую панель фильтров.
 */

import { moscowWeekLabel } from '@dkp/shared';

export type StatisticsTab = 'overview' | 'attendance' | 'activity' | 'dkp' | 'loot';
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

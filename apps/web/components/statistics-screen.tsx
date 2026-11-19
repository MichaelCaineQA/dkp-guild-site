'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { canViewGuildGearScore } from '@dkp/shared';
import { useSession } from './session-context';
import { api } from '../lib/api';
import {
  defaultStatisticsFilters,
  hasActiveStatisticsFilters,
  statisticsFilterQuery,
  StatisticsFilters,
  type StatisticsFilterOptions,
  type StatisticsFilterState,
} from './statistics-filters';
import {
  statisticsFocusLabel,
  type StatisticsFocus,
  type StatisticsTab,
} from './statistics-navigation';
import { StatisticsOverview } from './statistics-overview';
import { StatisticsAttendanceTab } from './statistics-attendance';
import { StatisticsActivityTab } from './statistics-activity';
import { ReportEmpty, ReportError, ReportSkeleton, useStatisticsReport } from './statistics-report';
import { Card, FocusChip, Notice, Page, PageHeader, Tabs, type TabItem } from './ui';

/**
 * «Статистика» (план 2.8, #218): маршрут, общий период и фильтры, вкладки
 * и состояния для всех отчётов этапа. Оболочка держит один общий запрос
 * основы (#212) выбранных условий, поэтому смена фильтров видна каждой
 * вкладке одинаково, а поздний ответ старого запроса новый отчёт не
 * заменяет. Переходы из обзора (#219) открывают вкладку с дополнительным
 * срезом, который виден чипом и снимается, не меняя общие фильтры.
 */

const TABS: Array<TabItem<StatisticsTab>> = [
  { key: 'overview', label: 'Обзор' },
  { key: 'attendance', label: 'Посещаемость' },
  { key: 'activity', label: 'Активность' },
  { key: 'dkp', label: 'ДКП' },
  { key: 'loot', label: 'Лут' },
];

const dayNumber = new Intl.DateTimeFormat('ru-RU', { day: 'numeric' });
const fullDate = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

function periodLabel(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  // Внутри одного месяца достаточно «1 – 31 декабря 2026 г.».
  return from.slice(0, 7) === to.slice(0, 7)
    ? `${dayNumber.format(start)} – ${fullDate.format(end)}`
    : `${fullDate.format(start)} – ${fullDate.format(end)}`;
}

export function StatisticsScreen({ now = new Date() }: { now?: Date }) {
  const { user, loading: sessionLoading } = useSession();
  const [options, setOptions] = useState<StatisticsFilterOptions | null>(null);
  const [filters, setFilters] = useState<StatisticsFilterState>(() =>
    defaultStatisticsFilters(now),
  );
  const [tab, setTab] = useState<StatisticsTab>('overview');
  const [focus, setFocus] = useState<StatisticsFocus | null>(null);
  // Отчёт запрашивается только для одобренных участников и Админа.
  const authorized = !!user && (!!user.memberId || !!user.isAdmin);
  const report = useStatisticsReport(authorized ? statisticsFilterQuery(filters) : null);

  // Смена общих условий делает срез перехода недействительным — снимаем его.
  const changeFilters = useCallback((next: StatisticsFilterState) => {
    setFilters(next);
    setFocus(null);
  }, []);

  /** Переход из обзора: вкладка + дополнительный срез (снимается чипом). */
  const go = useCallback((nextTab: StatisticsTab, nextFocus?: StatisticsFocus) => {
    setTab(nextTab);
    setFocus(nextFocus ?? null);
    window.history.replaceState(null, '', `/statistics?tab=${nextTab}`);
  }, []);

  // Глубокая ссылка на вкладку: /statistics?tab=dkp открывает её сразу.
  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('tab');
    if (requested && TABS.some((item) => item.key === requested)) {
      setTab(requested as StatisticsTab);
    }
  }, []);

  useEffect(() => {
    if (!sessionLoading && (user?.memberId || user?.isAdmin)) {
      let active = true;
      Promise.all([
        api<{ groups: StatisticsFilterOptions['kps'] }>('/org/roster'),
        api<StatisticsFilterOptions['eventTypes']>('/event-types'),
      ])
        .then(([roster, eventTypes]) => {
          if (active) setOptions({ kps: roster.groups, eventTypes });
        })
        .catch(() => undefined);
      return () => {
        active = false;
      };
    }
  }, [sessionLoading, user]);

  const query = statisticsFilterQuery(filters);
  const hasFilters = hasActiveStatisticsFilters(filters);

  // Подпись применённых условий: период всегда, фильтры — по выбору.
  const appliedLabel = useMemo(() => {
    if (!query) return null;
    const parts = [`Период: ${periodLabel(query.from, query.to)}`, 'По Москве, UTC+3'];
    const kpName = options?.kps.find((kp) => kp.id === query.kpId)?.name;
    if (kpName) parts.push(`КП: ${kpName}`);
    const packName = options?.kps
      .flatMap((kp) => kp.packs)
      .find((pack) => pack.id === query.packId)?.name;
    if (packName) parts.push(`Пак: ${packName}`);
    const typeName = options?.eventTypes.find((type) => type.id === query.eventTypeId)?.name;
    if (typeName) parts.push(`Тип ивента: ${typeName}`);
    if (query.mode) parts.push(query.mode === 'PVE' ? 'Режим: PvE' : 'Режим: PvP');
    return parts.join(' · ');
  }, [query, options]);

  const emptySelection =
    !!report.report &&
    report.report.events.length === 0 &&
    report.report.facts.length === 0 &&
    report.report.factsWithoutEvent.length === 0;

  if (sessionLoading) {
    return <Page>Загрузка…</Page>;
  }

  if (!user) {
    return (
      <Page>
        <PageHeader title="Статистика" subtitle="Раздел доступен членам гильдии после входа." />
      </Page>
    );
  }

  if (!user.memberId && !user.isAdmin) {
    return (
      <Page>
        <PageHeader
          title="Статистика"
          subtitle="Ваш аккаунт ещё не привязан к члену гильдии — отправьте заявку на привязку ника."
        />
      </Page>
    );
  }

  return (
    <Page width="wide">
      <PageHeader title="Статистика" subtitle="Посещаемость, активность, ДКП и лут" />

      <StatisticsFilters now={now} options={options} value={filters} onChange={changeFilters} />

      <Tabs
        items={TABS}
        value={tab}
        label="Разделы статистики"
        onChange={(key) => {
          setTab(key);
          setFocus(null);
          window.history.replaceState(null, '', `/statistics?tab=${key}`);
        }}
      />

      <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
        {focus && (
          <div className="mb-3">
            <FocusChip label={statisticsFocusLabel(focus)} onClear={() => setFocus(null)} />
          </div>
        )}
        {appliedLabel && <p className="mb-3 text-sm text-secondary">{appliedLabel}</p>}
        {!query ? (
          <Card>
            <Notice tone="info">Укажите корректный период — отчёт обновится автоматически.</Notice>
          </Card>
        ) : report.failed ? (
          <Card>
            <ReportError onRetry={report.reload} />
          </Card>
        ) : report.loading ? (
          <ReportSkeleton refreshing={report.refreshing} />
        ) : emptySelection ? (
          <Card>
            <ReportEmpty
              filtered={hasFilters}
              onResetFilters={() => changeFilters(defaultStatisticsFilters(now))}
            />
          </Card>
        ) : tab === 'overview' ? (
          <StatisticsOverview
            query={query}
            eventFilterActive={!!(query.eventTypeId || query.mode)}
            canViewGearScore={!!user && canViewGuildGearScore(user)}
            go={go}
          />
        ) : tab === 'attendance' ? (
          <StatisticsAttendanceTab query={query} focus={focus} options={options} />
        ) : tab === 'activity' ? (
          <StatisticsActivityTab query={query} focus={focus} options={options} />
        ) : (
          <Card>
            <Notice tone="info">
              Раздел статистики подключается. Выбранные период и фильтры уже применяются к его
              данным.
            </Notice>
          </Card>
        )}
      </div>
    </Page>
  );
}

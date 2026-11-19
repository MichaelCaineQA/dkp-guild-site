'use client';

import { useEffect, useRef, useState } from 'react';
import { statisticsQueryString, type StatisticsReport, type StatisticsQuery } from '@dkp/shared';
import { api } from '../lib/api';
import { Button, ErrorText, Muted } from './ui';

/**
 * Общий контейнер состояния отчётов статистики (#218): один общий запрос
 * основы (#212) на выбранный период и фильтры. Поколения запросов защищают
 * от позднего ответа старых условий; ошибка не превращается в пустые данные.
 * Профильные вкладки (#219–#222) строят свои виджеты на этих состояниях.
 */
export function useStatisticsReport(query: StatisticsQuery | null) {
  const [loaded, setLoaded] = useState<{ key: string; report: StatisticsReport } | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);
  const generation = useRef(0);
  const key = query ? statisticsQueryString(query) : null;

  useEffect(() => {
    if (!key) return;
    const request = ++generation.current;
    setFailed(false);
    api<StatisticsReport>(`/statistics?${key}`)
      .then((report) => {
        if (request !== generation.current) return;
        setLoaded({ key, report });
      })
      .catch(() => {
        if (request !== generation.current) return;
        setFailed(true);
      });
    return () => {
      generation.current++;
    };
  }, [key, reloadTick]);

  const current = loaded && loaded.key === key ? loaded.report : null;
  return {
    report: current,
    /** Первый запрос периода: каркас вместо данных. */
    loading: !!key && !current && !failed,
    /** Смена условий при уже показанном отчёте: старые данные скрыты. */
    refreshing: !!key && !!loaded && !current && !failed,
    failed,
    reload: () => setReloadTick((tick) => tick + 1),
  };
}

/** Каркас карточек и графиков на время загрузки/обновления. */
export function ReportSkeleton({ refreshing }: { refreshing?: boolean }) {
  return (
    <div role="status" aria-label={refreshing ? 'Обновление отчёта' : 'Загрузка отчёта'}>
      {refreshing && <Muted>Обновление…</Muted>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="h-20 animate-pulse rounded-lg bg-surface-muted" />
        ))}
      </div>
      <div className="mt-3 h-48 animate-pulse rounded-lg bg-surface-muted" />
    </div>
  );
}

/** Ошибка запроса с повтором; период и фильтры сохранены в панели сверху. */
export function ReportError({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert">
      <ErrorText>Не удалось загрузить отчёт</ErrorText>
      <Button onClick={onRetry}>Повторить</Button>
    </div>
  );
}

/**
 * Пустая выборка периода: без фильтров — «нет данных вообще», с фильтрами —
 * «ничего не найдено» со сбросом условий. Отличать эти случаи обязательно.
 */
export function ReportEmpty({
  filtered,
  onResetFilters,
}: {
  filtered: boolean;
  onResetFilters: () => void;
}) {
  return filtered ? (
    <div>
      <p className="text-secondary">По выбранным фильтрам ничего не найдено</p>
      <Button className="mt-2" onClick={onResetFilters}>
        Сбросить фильтры
      </Button>
    </div>
  ) : (
    <p className="text-secondary">Нет данных за выбранный период</p>
  );
}

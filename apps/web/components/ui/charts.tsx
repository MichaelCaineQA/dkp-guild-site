'use client';

import { useState, type ReactNode } from 'react';
import { moscowWeekLabel } from '@dkp/shared';
import { API_URL_VALUE } from '../../lib/api';
import { Button } from './controls';
import { ErrorText, Muted } from './layout';

/**
 * Кнопка «Скачать CSV» таблицы статистики (#223): скачивает всю серверную
 * выборку выбранных на момент запуска условий. Ошибка не создаёт пустой
 * «успешный» файл; имя берётся из Content-Disposition сервера.
 */
export function CsvButton({ path, label }: { path: string; label: string }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const download = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`${API_URL_VALUE}${path}`, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const disposition = response.headers.get('Content-Disposition') ?? '';
      const filename = /filename="([^"]+)"/.exec(disposition)?.[1] ?? 'statistics.csv';
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <Button onClick={download} disabled={busy} aria-label={`Скачать CSV: ${label}`}>
        {busy ? 'Готовим…' : 'Скачать CSV'}
      </Button>
      {failed && <ErrorText>Не удалось скачать CSV</ErrorText>}
    </span>
  );
}

/**
 * Сводная карточка статистики (план 2.8): число и подпись; клик открывает
 * связанную вкладку. Значение различимо текстом, не только цветом; ошибка
 * загрузки не превращается в ноль.
 */
export function StatCard({
  title,
  value,
  hint,
  onClick,
  error,
  onRetry,
}: {
  title: string;
  value: ReactNode;
  hint?: ReactNode;
  /** Клик по карточке открывает соответствующую вкладку/таблицу. */
  onClick?: () => void;
  error?: boolean;
  onRetry?: () => void;
}) {
  const body = error ? (
    <>
      <ErrorText>Не удалось загрузить</ErrorText>
      {onRetry && (
        <Button className="mt-1" onClick={onRetry}>
          Повторить
        </Button>
      )}
    </>
  ) : (
    <>
      <span className="block text-2xl font-semibold text-primary">{value}</span>
      {hint && <span className="mt-1 block text-xs text-secondary">{hint}</span>}
    </>
  );
  const className = 'min-w-0 rounded-xl border border-line bg-surface p-4 text-left shadow-sm';
  return onClick && !error ? (
    <button type="button" onClick={onClick} className={`${className} hover:bg-surface-muted`}>
      <span className="block text-sm text-secondary">{title}</span>
      {body}
    </button>
  ) : (
    <section aria-label={title} className={className}>
      <span className="block text-sm text-secondary">{title}</span>
      {body}
    </section>
  );
}

/** Столбец недельного графика: подпись дат, значение текстом, подсказка. */
export interface BarChartColumn {
  key: string;
  /** Подпись фактических дат недели (границы обрезаны периодом). */
  label: string;
  /** Числовое значение для высоты столбца; null — «нет знаменателя». */
  value: number | null;
  /** Значение, показываемое над столбцом текстом. */
  display: string;
  /** Подсказка по наведению/фокусу: исходные числа и даты. */
  hint: string;
}

/**
 * Столбчатый график недель (план 2.8): значения подписаны текстом, цвет —
 * дополнительное средство; каждый столбец доступен клавиатуре и раскрывает
 * детализацию кликом. Высота — от максимума выборки; null не рисует столбца.
 */
export function BarChart({
  label,
  columns,
  onSelect,
}: {
  /** aria-label графика. */
  label: string;
  columns: BarChartColumn[];
  /** Клик/Enter по столбцу открывает детализацию недели. */
  onSelect?: (column: BarChartColumn) => void;
}) {
  if (columns.length === 0) {
    return <p className="text-secondary">Нет данных за выбранный период</p>;
  }
  const max = Math.max(...columns.map((column) => column.value ?? 0), 1);
  return (
    <div role="img" aria-label={label} className="w-full overflow-x-auto">
      <div className="flex min-w-full items-end gap-2">
        {columns.map((column) => {
          const height =
            column.value === null || column.value <= 0 ? 0 : (column.value / max) * 100;
          const bar = (
            <>
              <span className="mb-1 block whitespace-nowrap text-xs tabular-nums text-primary">
                {column.display}
              </span>
              <span
                className={`block w-full rounded-t bg-accent ${height === 0 ? 'border-b-2 border-line' : ''}`}
                style={{ height: `${Math.max(height, 0)}%`, minHeight: height > 0 ? '2px' : '0' }}
              />
            </>
          );
          return (
            <div key={column.key} className="flex min-w-14 flex-1 flex-col items-center">
              {onSelect ? (
                <button
                  type="button"
                  title={column.hint}
                  aria-label={`${column.label}: ${column.display}. ${column.hint}`}
                  onClick={() => onSelect(column)}
                  className="flex h-40 w-full flex-col justify-end hover:bg-surface-muted"
                >
                  {bar}
                </button>
              ) : (
                <div title={column.hint} className="flex h-40 w-full flex-col justify-end">
                  {bar}
                </div>
              )}
              <span className="mt-1 whitespace-nowrap text-center text-xs text-secondary tabular-nums">
                {column.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Целочисленный формат ДКП с разделителями русской локали. */
export function formatDkp(value: number): string {
  return value.toLocaleString('ru-RU');
}

/** Процент посещаемости с одним десятичным; null — «нет знаменателя». */
export function formatAttendancePct(value: number | null): string {
  if (value === null) return '—';
  return `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })}%`;
}

/** Подпись фактических дат недели (shared, единая с CSV). */
export const weekLabel = moscowWeekLabel;

/** Дата-время среза/операции по Москве. */
export function moscowDateTime(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone: 'Europe/Moscow',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

/** Чип дополнительного среза с возможностью снятия (клик по графику/топу). */
export function FocusChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full bg-accent-soft px-3 py-1 text-sm text-accent">
      <Muted>Срез:</Muted> {label}
      <button
        type="button"
        aria-label={`Снять срез ${label}`}
        onClick={onClear}
        className="rounded px-1 hover:bg-surface-muted"
      >
        ✕
      </button>
    </span>
  );
}

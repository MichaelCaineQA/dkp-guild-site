'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  aggregateAttendance,
  compareAttendanceGroups,
  formatMoscowDayShort,
  moscowInclusiveDates,
  type AttendanceDetail,
  type AttendanceReport,
  type StatisticsQuery,
} from '@dkp/shared';
import { ReportError, useStatisticsEndpoint } from './statistics-report';
import type { StatisticsFilterOptions } from './statistics-filters';
import { csvPath, type StatisticsFocus } from './statistics-navigation';
import { BarChart, CsvButton, formatAttendancePct, weekLabel } from './ui/charts';
import { ATTENDANCE_STATUS_LABELS, CHECKIN_CODE_LABELS } from './ui/event-summary';
import { Badge, Card, Muted, SectionTitle, Table } from './ui/index';

/**
 * Вкладка «Посещаемость» (#220, план 2.8): разрезы игроки/паки/КП/гильдия,
 * таблица N/C/процента с уважительными отсутствиями и неявками, недельный
 * график, пояснение формулы и раскрытие строки до ивентов и отметок.
 * Все числа — серверные (#213); недели среза пересчитываются из тех же
 * деталей агрегатором shared, без среднего из процентов.
 */

type AttendanceCut = 'members' | 'packs' | 'kps' | 'guild';

const CUTS: Array<{ key: AttendanceCut; label: string }> = [
  { key: 'members', label: 'Игроки' },
  { key: 'packs', label: 'Паки' },
  { key: 'kps', label: 'КП' },
  { key: 'guild', label: 'Гильдия' },
];

interface AttendanceRow {
  /** Ключ раскрытия; у «Гильдии» — константа. */
  id: string;
  name: string;
  totals: ReturnType<typeof aggregateAttendance>;
  rows: AttendanceDetail[];
}

/** Команда из деталей: исторический пак/КП или явное отсутствие истории. */
function teamLabel(row: AttendanceDetail, options: StatisticsFilterOptions | null): string {
  if (row.teamStatus === 'NO_HISTORICAL_DATA') return 'Нет исторических данных';
  const pack = options?.kps.flatMap((kp) => kp.packs).find((p) => p.id === row.packId);
  const kp = options?.kps.find((k) => k.id === row.kpId);
  const packName = pack?.name ?? (row.packId ? null : 'Без пака');
  const kpName = kp?.name ?? null;
  return [packName, kpName].filter(Boolean).join(' · ') || 'Без пака';
}

export function StatisticsAttendanceTab({
  query,
  focus,
  options,
}: {
  query: StatisticsQuery & { from: string; to: string };
  focus: StatisticsFocus | null;
  options: StatisticsFilterOptions | null;
}) {
  const report = useStatisticsEndpoint<AttendanceReport>('/statistics/attendance', query);
  const [cut, setCut] = useState<AttendanceCut>('members');
  const [expanded, setExpanded] = useState<string | null>(null);

  const weekFocus = focus?.kind === 'week' ? focus : null;
  const memberFocus = focus?.kind === 'attendanceMember' ? focus : null;

  // Срез игрока из обзора раскрывает строку этого игрока.
  useEffect(() => {
    if (memberFocus) {
      setCut('members');
      setExpanded(memberFocus.memberId);
    }
  }, [memberFocus?.memberId, memberFocus]);

  const data = report.data;
  // Срез недели: детали только этой недели; итоги пересчитываются тем же
  // агрегатором, что и на сервере (без среднего из процентов).
  const details = useMemo(
    () =>
      data
        ? weekFocus
          ? data.details.filter(
              (row) => row.startsAt >= weekFocus.start && row.startsAt < weekFocus.end,
            )
          : data.details
        : [],
    [data, weekFocus?.start, weekFocus?.end],
  );

  // CSV деталей содержит полную выборку выбранной недели: границы по Москве
  // сужают период выгрузки, общие фильтры сохраняются (#249).
  const detailsQuery = weekFocus
    ? { ...query, ...moscowInclusiveDates(weekFocus.start, weekFocus.end) }
    : query;

  const rows = useMemo<AttendanceRow[]>(() => {
    if (!data) return [];
    if (cut === 'guild') {
      return [
        {
          id: 'guild',
          name: 'Гильдия',
          totals: aggregateAttendance(details),
          rows: details,
        },
      ];
    }
    const groups = new Map<string, AttendanceDetail[]>();
    for (const row of details) {
      let key: string;
      if (cut === 'members') key = `m:${row.memberId}`;
      else if (row.teamStatus === 'NO_HISTORICAL_DATA') key = 'unknown';
      else
        key = `${cut === 'packs' ? 'p' : 'k'}:${row[cut === 'packs' ? 'packId' : 'kpId'] ?? 'none'}`;
      groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups]
      .map(([key, groupRows]) => {
        const first = groupRows[0]!;
        const id =
          key === 'unknown'
            ? 'unknown'
            : cut === 'members'
              ? first.memberId
              : (first[cut === 'packs' ? 'packId' : 'kpId'] ?? 'none');
        const name =
          key === 'unknown'
            ? 'Нет исторических данных'
            : cut === 'members'
              ? first.nickname
              : cut === 'packs'
                ? (options?.kps.flatMap((kp) => kp.packs).find((p) => p.id === first.packId)
                    ?.name ?? 'Без пака')
                : (options?.kps.find((kp) => kp.id === first.kpId)?.name ?? 'Без КП');
        return {
          id: key === 'unknown' ? 'unknown' : id,
          name,
          totals: aggregateAttendance(groupRows),
          rows: groupRows,
        };
      })
      .sort(compareAttendanceGroups);
  }, [data, details, cut, options]);

  if (report.failed) {
    return (
      <Card>
        <ReportError onRetry={report.reload} />
      </Card>
    );
  }
  if (!data) {
    return (
      <Card>
        <div
          role="status"
          aria-label="Загрузка отчёта посещаемости"
          className="h-40 animate-pulse rounded-lg bg-surface-muted"
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <SectionTitle className="mb-0">Посещаемость</SectionTitle>
          <div className="flex flex-wrap items-center gap-2">
            <CsvButton
              path={csvPath('attendance', { cut }, query)}
              label={`посещаемость: ${CUTS.find((item) => item.key === cut)?.label ?? cut}`}
            />
            <CsvButton
              path={csvPath('attendance', { cut: 'details' }, detailsQuery)}
              label="детали посещаемости"
            />
            <div role="group" aria-label="Разрез посещаемости" className="flex flex-wrap gap-2">
              {CUTS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={cut === item.key}
                  onClick={() => {
                    setCut(item.key);
                    setExpanded(null);
                  }}
                  className={`rounded-lg border px-3 py-1 text-sm ${
                    cut === item.key
                      ? 'border-accent bg-accent-soft text-accent'
                      : 'border-line bg-surface text-primary hover:bg-surface-muted'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* Формула доступна по нажатию и с клавиатуры (нативный details). */}
        <details className="mb-3 rounded-lg border border-line bg-surface-muted p-3 text-sm">
          <summary className="cursor-pointer text-secondary">Как считается посещаемость</summary>
          <p className="mt-2">
            посещаемость = (число принятых отметок / 2) / число учитываемых ивентов × 100%. Один
            принятый код даёт половину участия, два — полное; ручная отметка равнозначна коду.
            Уважительные отсутствия исключаются из расчёта, пропуски без причины остаются в
            знаменателе. Только завершённые ивенты, на которые игрок был приглашён. Командный
            процент — по суммарным отметкам и участиям, не усреднением процентов.
          </p>
        </details>
        <Table>
          <thead>
            <tr>
              <Table.Th>{cut === 'members' ? 'Игрок' : 'Команда'}</Table.Th>
              <Table.Th>{cut === 'guild' ? 'Участия' : 'Ивенты'}</Table.Th>
              <Table.Th>Отметки</Table.Th>
              <Table.Th>Посещаемость</Table.Th>
              <Table.Th>Ув. отсутствия</Table.Th>
              <Table.Th>Неявки</Table.Th>
              <Table.Th>Опоздания</Table.Th>
              <Table.Th>Ранние уходы</Table.Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <AttendanceTableRow
                key={row.id}
                row={row}
                expanded={expanded === row.id}
                onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
                options={options}
              />
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && <Muted>Нет данных за выбранный период</Muted>}
      </Card>

      <Card>
        <SectionTitle>Динамика по неделям</SectionTitle>
        <BarChart
          label="Посещаемость по неделям, процентов"
          columns={data.weeks.map((week) => ({
            key: week.start,
            label: weekLabel(week.start, week.end),
            value: week.totals.percentage,
            display: formatAttendancePct(week.totals.percentage),
            hint: `Отметки ${week.totals.checks} из ${week.totals.events * 2}, участий ${week.totals.events}`,
          }))}
        />
      </Card>
    </div>
  );
}

function AttendanceTableRow({
  row,
  expanded,
  onToggle,
  options,
}: {
  row: AttendanceRow;
  expanded: boolean;
  onToggle: () => void;
  options: StatisticsFilterOptions | null;
}) {
  const pct = formatAttendancePct(row.totals.percentage);
  return (
    <>
      {/* Клик по строке — мышью; клавиатурный доступ — кнопка раскрытия (#252). */}
      <Table.Row onClick={onToggle} aria-label={`Детали: ${row.name}`}>
        <Table.Td className="font-medium">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            aria-expanded={expanded}
            aria-label={`Детали: ${row.name}`}
            className="mr-1 inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-0.5 text-sm font-medium text-primary hover:bg-surface-muted focus:border-accent focus:outline-none"
          >
            <span aria-hidden="true" className="text-secondary">
              {expanded ? '▾' : '▸'}
            </span>
            {row.name}
          </button>
          {row.totals.historyStatus === 'NO_HISTORICAL_DATA' && (
            <Badge tone="warning" className="ml-2">
              Нет исторических данных
            </Badge>
          )}
        </Table.Td>
        {/* Для команд это пары игрок–ивент, а не уникальные ивенты. */}
        <Table.Td className="tabular-nums">{row.totals.events}</Table.Td>
        <Table.Td className="tabular-nums">{row.totals.checks}</Table.Td>
        <Table.Td
          className="tabular-nums"
          title={row.totals.events === 0 ? 'Нет ивентов для расчёта' : undefined}
        >
          {pct}
        </Table.Td>
        <Table.Td className="tabular-nums">{row.totals.excused}</Table.Td>
        <Table.Td className="tabular-nums">{row.totals.noShow}</Table.Td>
        <Table.Td className="tabular-nums">{row.totals.late}</Table.Td>
        <Table.Td className="tabular-nums">{row.totals.leftEarly}</Table.Td>
      </Table.Row>
      {expanded && (
        <tr>
          <td colSpan={8} className="border-b border-line bg-surface-muted p-3">
            <p className="mb-2 text-sm text-secondary">
              Ивенты и принятые отметки ({row.rows.length} пар игрок–ивент)
            </p>
            <Table>
              <thead>
                <tr>
                  <Table.Th>Дата</Table.Th>
                  <Table.Th>Ивент</Table.Th>
                  <Table.Th>Старт</Table.Th>
                  <Table.Th>Финал</Table.Th>
                  <Table.Th>Итог</Table.Th>
                  <Table.Th>Команда на момент ивента</Table.Th>
                </tr>
              </thead>
              <tbody>
                {row.rows
                  .slice()
                  .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
                  .map((detail) => (
                    <tr key={`${detail.eventId}:${detail.memberId}`}>
                      {/* Дата одиночного ивента — один день Москвы, без диапазона (#254). */}
                      <Table.Td className="tabular-nums">
                        {formatMoscowDayShort(detail.startsAt)}
                      </Table.Td>
                      <Table.Td>{detail.eventName || detail.eventId}</Table.Td>
                      <Table.Td>
                        {CHECKIN_CODE_LABELS[detail.checkinStart ?? 'PENDING'] ?? '—'}
                      </Table.Td>
                      <Table.Td>
                        {CHECKIN_CODE_LABELS[detail.checkinEnd ?? 'PENDING'] ?? '—'}
                      </Table.Td>
                      <Table.Td>
                        {ATTENDANCE_STATUS_LABELS[detail.status] ?? detail.status}
                      </Table.Td>
                      <Table.Td>{teamLabel(detail, options)}</Table.Td>
                    </tr>
                  ))}
              </tbody>
            </Table>
          </td>
        </tr>
      )}
    </>
  );
}

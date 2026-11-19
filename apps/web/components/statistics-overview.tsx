'use client';

import {
  type ActivityReport,
  type AttendanceReport,
  type DkpStatisticsReport,
  type GearScoreStatisticsReport,
  type LootStatisticsReport,
  type StatisticsQuery,
} from '@dkp/shared';
import { Avatar } from './avatar';
import { ReportError, useStatisticsEndpoint } from './statistics-report';
import type { StatisticsFocus, StatisticsTab } from './statistics-navigation';
import {
  BarChart,
  formatAttendancePct,
  formatDkp,
  moscowDateTime,
  StatCard,
  weekLabel,
} from './ui/charts';
import { Badge, Card, Muted, SectionTitle, Table } from './ui/index';

/**
 * Вкладка «Обзор» (#219, план 2.8): сводные карточки, недельные графики,
 * топ посещаемости, активность по типам, топ лута и защищённый блок
 * свежести GS. Числа берутся из серверных отчётов #213–#217 без пересчёта;
 * клик по карточке/графику/строке открывает соответствующую вкладку
 * с дополнительным срезом.
 */
export function StatisticsOverview({
  query,
  eventFilterActive,
  canViewGearScore,
  go,
}: {
  query: StatisticsQuery & { from: string; to: string };
  /** Выбраны тип ивента или режим — срез GS их игнорирует, подписываем. */
  eventFilterActive: boolean;
  /** Блок GS видит и запрашивает только Глава/Админ (план 2.5). */
  canViewGearScore: boolean;
  go: (tab: StatisticsTab, focus?: StatisticsFocus) => void;
}) {
  const attendance = useStatisticsEndpoint<AttendanceReport>('/statistics/attendance', query);
  const activity = useStatisticsEndpoint<ActivityReport>('/statistics/activity', query);
  const dkp = useStatisticsEndpoint<DkpStatisticsReport>('/statistics/dkp', query);
  const loot = useStatisticsEndpoint<LootStatisticsReport>('/statistics/loot', query);
  const gearScore = useStatisticsEndpoint<GearScoreStatisticsReport>(
    '/statistics/gear-score',
    canViewGearScore ? query : null,
  );

  const attendanceData = attendance.data;
  const attendanceTotals = attendanceData?.overview.totals;
  const weekColumn = (week: { start: string; end: string }) => ({
    key: week.start,
    label: weekLabel(week.start, week.end),
  });

  return (
    <div className="space-y-4">
      {/* Сводные карточки: числа из отчётов посещаемости и ДКП (#213/#215). */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {attendance.failed ? (
          <Card className="col-span-full">
            <ReportError onRetry={attendance.reload} />
          </Card>
        ) : attendanceData ? (
          <>
            <StatCard
              title="Активные участники"
              value={attendanceData.overview.activeMembers}
              hint="хотя бы одна принятая отметка"
              onClick={() => go('activity', { kind: 'activityTable', table: 'members' })}
            />
            <StatCard
              title="Завершено ивентов"
              value={attendanceData.overview.finishedEvents}
              hint="разных завершённых ивентов выборки"
              onClick={() => go('activity', { kind: 'activityTable', table: 'events' })}
            />
            <StatCard
              title="Посещаемость"
              value={formatAttendancePct(attendanceTotals?.percentage ?? null)}
              hint={
                attendanceTotals && attendanceTotals.events > 0
                  ? `${attendanceTotals.checks} отметок из ${attendanceTotals.events * 2} · ${attendanceTotals.events} ивентов`
                  : 'Нет ивентов для расчёта'
              }
              onClick={() => go('attendance')}
            />
          </>
        ) : (
          <div
            role="status"
            aria-label="Загрузка сводки"
            className="col-span-full h-20 animate-pulse rounded-lg bg-surface-muted"
          />
        )}
        {dkp.failed ? (
          <StatCard title="Начислено ДКП" value="—" error onRetry={dkp.reload} />
        ) : dkp.data ? (
          <StatCard
            title="Начислено ДКП"
            value={formatDkp(dkp.data.totals.earned)}
            hint="чек-ин и ручные начисления, без трат и корректировок"
            onClick={() => go('dkp', { kind: 'dkpSection', section: 'earned' })}
          />
        ) : (
          <div
            role="status"
            aria-label="Загрузка ДКП"
            className="h-20 animate-pulse rounded-lg bg-surface-muted"
          />
        )}
      </div>

      {/* Недельные графики: недели обрезаны периодом, подписаны фактическими датами. */}
      {attendance.failed ? null : attendanceData ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <SectionTitle>Посещаемость по неделям</SectionTitle>
            <BarChart
              label="Посещаемость по неделям, процентов"
              columns={attendanceData.weeks.map((week) => ({
                ...weekColumn(week),
                value: week.totals.percentage,
                display: formatAttendancePct(week.totals.percentage),
                hint: `Отметки ${week.totals.checks} из ${week.totals.events * 2}, ивентов ${week.totals.events}`,
              }))}
              onSelect={(column) =>
                go('attendance', {
                  kind: 'week',
                  start: column.key,
                  end: endOfWeek(attendanceData, column.key),
                })
              }
            />
          </Card>
          <Card>
            <SectionTitle>Завершённые ивенты по неделям</SectionTitle>
            <BarChart
              label="Завершённые ивенты по неделям"
              columns={attendanceData.weeks.map((week) => ({
                ...weekColumn(week),
                value: week.totals.events,
                display: String(week.totals.events),
                hint: `Завершённых ивентов ${week.totals.events}`,
              }))}
              onSelect={(column) =>
                go('attendance', {
                  kind: 'week',
                  start: column.key,
                  end: endOfWeek(attendanceData, column.key),
                })
              }
            />
          </Card>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Топ по посещаемости: сортировка сервера, N=0 в рейтинг не попадает. */}
        {!attendance.failed && (
          <Card>
            <SectionTitle>Топ по посещаемости</SectionTitle>
            {attendanceData ? (
              attendanceData.top.length === 0 ? (
                <Muted>Нет данных за выбранный период</Muted>
              ) : (
                <ul className="space-y-1">
                  {attendanceData.top.map((row) => (
                    <li key={row.id}>
                      <button
                        type="button"
                        onClick={() =>
                          row.id &&
                          go('attendance', {
                            kind: 'attendanceMember',
                            memberId: row.id,
                            nickname: row.name ?? '',
                          })
                        }
                        className="flex w-full flex-wrap items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-muted"
                        aria-label={`Посещаемость ${row.name}: ${formatAttendancePct(row.totals.percentage)}`}
                      >
                        <Avatar
                          avatar={row.avatar}
                          avatarColor={row.avatarColor}
                          nickname={row.name ?? ''}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{row.name}</span>
                          <span className="block text-sm text-secondary tabular-nums">
                            {row.totals.checks} отметок из {row.totals.events * 2} ·{' '}
                            {row.totals.events} ивентов
                          </span>
                        </span>
                        <span className="font-semibold tabular-nums">
                          {formatAttendancePct(row.totals.percentage)}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <div role="status" className="h-24 animate-pulse rounded-lg bg-surface-muted" />
            )}
          </Card>
        )}

        {/* Активность по типам ивентов (#214): клик — срез типа на вкладке. */}
        <Card>
          <SectionTitle>Активность по типам ивентов</SectionTitle>
          {activity.failed ? (
            <ReportError onRetry={activity.reload} />
          ) : activity.data ? (
            activity.data.byType.length === 0 ? (
              <Muted>Нет данных за выбранный период</Muted>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Table.Th>Тип</Table.Th>
                    <Table.Th>Завершено</Table.Th>
                    <Table.Th>Участники</Table.Th>
                    <Table.Th>Посещаемость</Table.Th>
                  </tr>
                </thead>
                <tbody>
                  {activity.data.byType.map((row) => (
                    <Table.Row
                      key={row.eventTypeId}
                      onClick={() =>
                        go('activity', {
                          kind: 'activityType',
                          eventTypeId: row.eventTypeId,
                          name: row.name,
                        })
                      }
                      aria-label={`Активность: ${row.name}`}
                    >
                      <Table.Td>{row.name}</Table.Td>
                      <Table.Td className="tabular-nums">{row.totals.events}</Table.Td>
                      <Table.Td className="tabular-nums">{row.totals.visited}</Table.Td>
                      <Table.Td className="tabular-nums">
                        {formatAttendancePct(row.totals.attendance)}
                      </Table.Td>
                    </Table.Row>
                  ))}
                </tbody>
              </Table>
            )
          ) : (
            <div role="status" className="h-24 animate-pulse rounded-lg bg-surface-muted" />
          )}
        </Card>
      </div>

      {/* Топ выпавших предметов (#216): знаменатель — вся выборка «Выпало». */}
      <Card>
        <SectionTitle>Чаще всего выпадает</SectionTitle>
        {loot.failed ? (
          <ReportError onRetry={loot.reload} />
        ) : loot.data ? (
          loot.data.top.length === 0 ? (
            <Muted>Нет данных за выбранный период</Muted>
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Table.Th>Предмет</Table.Th>
                    <Table.Th>Количество</Table.Th>
                    <Table.Th>Доля выпадений</Table.Th>
                  </tr>
                </thead>
                <tbody>
                  {loot.data.top.map((row) =>
                    row.kind === 'ITEM' ? (
                      <Table.Row
                        key={row.itemId}
                        onClick={() =>
                          go('loot', { kind: 'lootItem', itemId: row.itemId, name: row.itemName })
                        }
                        aria-label={`Выпадения: ${row.itemName}`}
                      >
                        <Table.Td>
                          {row.itemName}
                          {row.isArchboss && (
                            <Badge tone="warning" className="ml-2">
                              Архибосс
                            </Badge>
                          )}
                        </Table.Td>
                        <Table.Td className="tabular-nums">{row.count}</Table.Td>
                        <Table.Td className="tabular-nums">{row.sharePct}%</Table.Td>
                      </Table.Row>
                    ) : (
                      <tr key="rest">
                        <Table.Td className="text-secondary">Остальное</Table.Td>
                        <Table.Td className="tabular-nums text-secondary">{row.count}</Table.Td>
                        <Table.Td className="tabular-nums text-secondary">{row.sharePct}%</Table.Td>
                      </tr>
                    ),
                  )}
                </tbody>
              </Table>
              <p className="mt-2 text-sm text-secondary">
                Всего выпадений в выборке: {loot.data.dropped.totals.drops}
              </p>
            </>
          )
        ) : (
          <div role="status" className="h-24 animate-pulse rounded-lg bg-surface-muted" />
        )}
      </Card>

      {/* Свежесть GS (#217): только Глава/Админ; значения GS в отчёте нет. */}
      {canViewGearScore &&
        (gearScore.failed ? (
          <Card>
            <SectionTitle>Свежесть GS</SectionTitle>
            <ReportError onRetry={gearScore.reload} />
          </Card>
        ) : gearScore.data ? (
          <Card>
            <SectionTitle>Свежесть GS</SectionTitle>
            <div className="flex flex-wrap gap-3">
              <Badge tone="success">Актуальные: {gearScore.data.totals.fresh}</Badge>
              <Badge tone="warning">Устаревшие: {gearScore.data.totals.stale}</Badge>
              <Badge tone="danger">Без скриншота: {gearScore.data.totals.missing}</Badge>
              <Badge>
                Доля устаревших:{' '}
                {gearScore.data.totals.staleSharePct === null
                  ? '—'
                  : `${gearScore.data.totals.staleSharePct}%`}
              </Badge>
            </div>
            <p className="mt-3 text-sm text-secondary">
              Срез на {moscowDateTime(gearScore.data.asOf)} · порог {gearScore.data.staleDays} дн. ·
              участников среза {gearScore.data.totals.members}
            </p>
            {eventFilterActive && (
              <p className="mt-1 text-sm text-secondary">
                Тип ивента и режим не влияют на срез свежести GS.
              </p>
            )}
          </Card>
        ) : (
          <Card>
            <SectionTitle>Свежесть GS</SectionTitle>
            <div role="status" className="h-16 animate-pulse rounded-lg bg-surface-muted" />
          </Card>
        ))}
    </div>
  );
}

/** Конечная граница недели из отчёта по её началу (для среза перехода). */
function endOfWeek(report: AttendanceReport, weekStart: string): string {
  const week = report.weeks.find((row) => row.start === weekStart);
  return week ? week.end : weekStart;
}

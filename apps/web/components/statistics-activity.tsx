'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  can,
  canManageEvent,
  formatMoscowDayShort,
  type ActivityReport,
  type DashboardEvent,
  type StatisticsQuery,
} from '@dkp/shared';
import { EventCard } from './event-card';
import { ReportError, useGameTime, useStatisticsEndpoint } from './statistics-report';
import type { StatisticsFilterOptions } from './statistics-filters';
import { csvPath, type StatisticsFocus } from './statistics-navigation';
import { useSession } from './session-context';
import { api } from '../lib/api';
import { BarChart, CsvButton, formatAttendancePct, weekLabel } from './ui/charts';
import { ATTENDANCE_STATUS_LABELS } from './ui/event-summary';
import { Badge, Card, Muted, Notice, SectionTitle, Table, TextLink } from './ui/index';

/**
 * Вкладка «Активность» (#220, план 2.8): участие по типам и режиму, недельная
 * динамика и пик по московскому времени, таблицы игроков и ивентов (#214).
 * Один принятый код = одно посещённое событие, процент учитывает половины.
 * Ивент открывается общей EventCard, игрок — профилем с правами цели.
 */

const MODE_LABELS: Record<string, string> = { PVE: 'PvE', PVP: 'PvP' };
const WEEKDAY_LABELS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export function StatisticsActivityTab({
  query,
  focus,
  options,
}: {
  query: StatisticsQuery & { from: string; to: string };
  focus: StatisticsFocus | null;
  options: StatisticsFilterOptions | null;
}) {
  const report = useStatisticsEndpoint<ActivityReport>('/statistics/activity', query);
  const typeFocus = focus?.kind === 'activityType' ? focus : null;
  const data = report.data;

  const byType = useMemo(
    () =>
      data
        ? typeFocus
          ? data.byType.filter((row) => row.eventTypeId === typeFocus.eventTypeId)
          : data.byType
        : [],
    [data, typeFocus?.eventTypeId],
  );
  const members = useMemo(
    () =>
      data
        ? typeFocus
          ? data.members.map((row) => ({
              ...row,
              byType: row.byType.filter((t) => t.eventTypeId === typeFocus.eventTypeId),
              details: row.details.filter((d) => d.eventTypeId === typeFocus.eventTypeId),
            }))
          : data.members
        : [],
    [data, typeFocus?.eventTypeId],
  );
  const events = useMemo(
    () =>
      data
        ? typeFocus
          ? data.events.filter((row) => row.eventTypeId === typeFocus.eventTypeId)
          : data.events
        : [],
    [data, typeFocus?.eventTypeId],
  );

  const gameTime = useGameTime();
  const { user } = useSession();
  const [openEvent, setOpenEvent] = useState<DashboardEvent | null>(null);
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [eventError, setEventError] = useState(false);

  // Срез таблицы из карточек обзора прокручивает к соответствующей таблице.
  useEffect(() => {
    if (focus?.kind === 'activityTable') {
      const target = document.getElementById(`activity-${focus.table}`);
      if (target && typeof target.scrollIntoView === 'function')
        target.scrollIntoView({ block: 'start' });
    }
  }, [focus]);

  const openEventCard = async (eventId: string) => {
    setEventError(false);
    try {
      setOpenEvent(await api<DashboardEvent>(`/events/${eventId}`));
    } catch {
      setEventError(true);
    }
  };

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
          aria-label="Загрузка отчёта активности"
          className="h-40 animate-pulse rounded-lg bg-surface-muted"
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="mb-0">Активность по типам ивентов</SectionTitle>
          <span className="flex flex-wrap gap-2">
            <CsvButton
              path={csvPath('activity', { table: 'types' }, query)}
              label="типы активности"
            />
            <CsvButton
              path={csvPath('activity', { table: 'modes' }, query)}
              label="режимы активности"
            />
          </span>
        </div>
        <Table>
          <thead>
            <tr>
              <Table.Th>Тип</Table.Th>
              <Table.Th>Завершено ивентов</Table.Th>
              <Table.Th>Участия</Table.Th>
              <Table.Th>Посещено</Table.Th>
              <Table.Th>Отметки</Table.Th>
              <Table.Th>Посещаемость</Table.Th>
            </tr>
          </thead>
          <tbody>
            {byType.map((row) => (
              <tr key={row.eventTypeId} aria-label={`Активность: ${row.name}`}>
                <Table.Td className="font-medium">{row.name}</Table.Td>
                <Table.Td className="tabular-nums">{row.totals.events}</Table.Td>
                <Table.Td className="tabular-nums">{row.totals.counted}</Table.Td>
                <Table.Td className="tabular-nums">{row.totals.visited}</Table.Td>
                <Table.Td className="tabular-nums">{row.totals.checks}</Table.Td>
                <Table.Td className="tabular-nums">
                  {formatAttendancePct(row.totals.attendance)}
                </Table.Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {byType.length === 0 && <Muted>Нет данных за выбранный период</Muted>}
        <p className="mt-3 mb-1 text-sm text-secondary">Режим</p>
        <Table>
          <thead>
            <tr>
              <Table.Th>Режим</Table.Th>
              <Table.Th>Завершено ивентов</Table.Th>
              <Table.Th>Участия</Table.Th>
              <Table.Th>Посещено</Table.Th>
              <Table.Th>Отметки</Table.Th>
              <Table.Th>Посещаемость</Table.Th>
            </tr>
          </thead>
          <tbody>
            {data.byMode.map((row) => (
              <tr key={row.mode}>
                <Table.Td className="font-medium">{MODE_LABELS[row.mode]}</Table.Td>
                <Table.Td className="tabular-nums">{row.totals.events}</Table.Td>
                <Table.Td className="tabular-nums">{row.totals.counted}</Table.Td>
                <Table.Td className="tabular-nums">{row.totals.visited}</Table.Td>
                <Table.Td className="tabular-nums">{row.totals.checks}</Table.Td>
                <Table.Td className="tabular-nums">
                  {formatAttendancePct(row.totals.attendance)}
                </Table.Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      {/* Недельная динамика и пик считают всю выборку периода; при срезе типа
          они скрыты с пояснением, чтобы не выдавать неотфильтрованное за срез. */}
      {!typeFocus && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <SectionTitle className="mb-0">Динамика по неделям</SectionTitle>
              <CsvButton
                path={csvPath('activity', { table: 'weeks' }, query)}
                label="недельная динамика"
              />
            </div>
            <BarChart
              label="Посещённые участия по неделям"
              columns={data.weeks.map((week) => ({
                key: week.start,
                label: weekLabel(week.start, week.end),
                value: week.totals.visited,
                display: String(week.totals.visited),
                hint: `Посещено участий ${week.totals.visited}, отметок ${week.totals.checks}`,
              }))}
            />
          </Card>
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <SectionTitle className="mb-0">Пик активности</SectionTitle>
              <span className="flex flex-wrap gap-2">
                <CsvButton
                  path={csvPath('activity', { table: 'peak-weekday' }, query)}
                  label="пик по дням недели"
                />
                <CsvButton
                  path={csvPath('activity', { table: 'peak-hour' }, query)}
                  label="пик по часам"
                />
              </span>
            </div>
            <p className="mb-2 text-sm text-secondary">
              Посещённые участия по началу ивента, московское время (UTC+3).
            </p>
            <p className="mb-1 text-sm text-secondary">По дням недели</p>
            <BarChart
              label="Пик активности по дням недели"
              columns={data.peak.byWeekday.map((row) => ({
                key: `wd-${row.weekday}`,
                label: WEEKDAY_LABELS[row.weekday] ?? String(row.weekday),
                value: row.visited,
                display: String(row.visited),
                hint: `${WEEKDAY_LABELS[row.weekday]}: посещено участий ${row.visited}`,
              }))}
            />
            <p className="mt-3 mb-1 text-sm text-secondary">По часам начала</p>
            <BarChart
              label="Пик активности по часам Москвы"
              columns={data.peak.byHour.map((row) => ({
                key: `h-${row.hour}`,
                label: String(row.hour),
                value: row.visited,
                display: String(row.visited),
                hint: `${row.hour}:00 — посещено участий ${row.visited}`,
              }))}
            />
          </Card>
        </div>
      )}
      {typeFocus && (
        <Notice>
          Недели и пик активности считают всю выборку периода — снимите срез типа, чтобы их увидеть.
        </Notice>
      )}

      <Card id="activity-members">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="mb-0">Игроки</SectionTitle>
          <span className="flex flex-wrap gap-2">
            <CsvButton
              path={csvPath('activity', { table: 'members' }, query)}
              label="игроки активности"
            />
            <CsvButton
              path={csvPath('activity', { table: 'member-details' }, query)}
              label="участия игроков"
            />
          </span>
        </div>
        <Table>
          <thead>
            <tr>
              <Table.Th>Ник</Table.Th>
              <Table.Th>Посещено ивентов</Table.Th>
              <Table.Th>Отметки</Table.Th>
              <Table.Th>По типам</Table.Th>
            </tr>
          </thead>
          <tbody>
            {members.map((row) => (
              <Fragment key={row.id}>
                <Table.Row
                  onClick={() => setExpandedMember(expandedMember === row.id ? null : row.id)}
                  aria-expanded={expandedMember === row.id}
                  aria-label={`Детали активности: ${row.nickname}`}
                >
                  <Table.Td className="font-medium">
                    <TextLink
                      href={`/profiles/${encodeURIComponent(row.id)}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.nickname}
                    </TextLink>
                  </Table.Td>
                  <Table.Td className="tabular-nums">{row.totals.visited}</Table.Td>
                  <Table.Td className="tabular-nums">{row.totals.checks}</Table.Td>
                  <Table.Td className="text-secondary">
                    {row.byType.map((t) => `${t.name}: ${t.totals.visited}`).join(' · ') || '—'}
                  </Table.Td>
                </Table.Row>
                {expandedMember === row.id && (
                  <tr>
                    <td colSpan={4} className="border-b border-line bg-surface-muted p-3">
                      <Table>
                        <thead>
                          <tr>
                            <Table.Th>Дата</Table.Th>
                            <Table.Th>Ивент</Table.Th>
                            <Table.Th>Тип</Table.Th>
                            <Table.Th>Режим</Table.Th>
                            <Table.Th>Итог</Table.Th>
                            <Table.Th>Отметки</Table.Th>
                            <Table.Th>Команда на момент ивента</Table.Th>
                          </tr>
                        </thead>
                        <tbody>
                          {row.details.map((detail) => (
                            <tr key={`${row.id}:${detail.eventId}`}>
                              {/* Дата одиночного ивента — один день Москвы (#254). */}
                              <Table.Td className="tabular-nums">
                                {formatMoscowDayShort(detail.startsAt)}
                              </Table.Td>
                              <Table.Td>{detail.eventName || detail.eventId}</Table.Td>
                              <Table.Td>{detail.eventTypeName}</Table.Td>
                              <Table.Td>{MODE_LABELS[detail.mode]}</Table.Td>
                              <Table.Td>
                                {ATTENDANCE_STATUS_LABELS[detail.status] ?? detail.status}
                              </Table.Td>
                              <Table.Td className="tabular-nums">{detail.checks}</Table.Td>
                              <Table.Td>
                                {teamNameOf(detail.packId, detail.kpId, detail.teamStatus, options)}
                              </Table.Td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </Table>
        {members.length === 0 && <Muted>Нет данных за выбранный период</Muted>}
      </Card>

      <Card id="activity-events">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <SectionTitle className="mb-0">Ивенты</SectionTitle>
          <CsvButton
            path={csvPath('activity', { table: 'events' }, query)}
            label="ивенты активности"
          />
        </div>
        {eventError && <Muted>Не удалось открыть ивент</Muted>}
        <Table>
          <thead>
            <tr>
              <Table.Th>Дата</Table.Th>
              <Table.Th>Название</Table.Th>
              <Table.Th>Тип</Table.Th>
              <Table.Th>Режим</Table.Th>
              <Table.Th>Область приглашения</Table.Th>
              <Table.Th>Участвовало / приглашено</Table.Th>
              <Table.Th>Посещаемость</Table.Th>
            </tr>
          </thead>
          <tbody>
            {events.map((row) => (
              <tr key={row.id} aria-label={`Ивент: ${row.name || row.eventTypeName}`}>
                {/* Дата одиночного ивента — один день Москвы (#254). */}
                <Table.Td className="tabular-nums">{formatMoscowDayShort(row.startsAt)}</Table.Td>
                <Table.Td className="font-medium">
                  <button
                    type="button"
                    className="text-accent underline"
                    onClick={() => void openEventCard(row.id)}
                  >
                    {row.name || row.eventTypeName}
                  </button>
                </Table.Td>
                <Table.Td>{row.eventTypeName}</Table.Td>
                <Table.Td>
                  <Badge tone="accent">{MODE_LABELS[row.mode]}</Badge>
                </Table.Td>
                <Table.Td>{row.scopeName}</Table.Td>
                <Table.Td className="tabular-nums">
                  {row.visited} / {row.invited}
                </Table.Td>
                <Table.Td className="tabular-nums">{formatAttendancePct(row.attendance)}</Table.Td>
              </tr>
            ))}
          </tbody>
        </Table>
        {events.length === 0 && <Muted>Нет данных за выбранный период</Muted>}
      </Card>

      {openEvent && user && (
        <EventCard
          event={openEvent}
          gameTime={gameTime}
          canManage={canManageEvent(user, openEvent)}
          canConduct={can(user, 'events.conduct', openEvent)}
          onClose={() => setOpenEvent(null)}
          onChanged={() => report.reload()}
        />
      )}
    </div>
  );
}

/** Команда участия: исторический пак/КП или пометка недостаточной истории. */
function teamNameOf(
  packId: string | null,
  kpId: string | null,
  teamStatus: string,
  options: StatisticsFilterOptions | null,
): string {
  if (teamStatus === 'NO_HISTORICAL_DATA') return 'Нет исторических данных';
  const pack = options?.kps.flatMap((kp) => kp.packs).find((p) => p.id === packId);
  const kp = options?.kps.find((k) => k.id === kpId);
  return [pack?.name ?? 'Без пака', kp?.name].filter(Boolean).join(' · ');
}

'use client';

import { Fragment, useEffect, useState } from 'react';
import type { DkpMovement, DkpStatisticsReport, DkpTotals, StatisticsQuery } from '@dkp/shared';
import { ReportError, useStatisticsEndpoint } from './statistics-report';
import type { StatisticsFilterOptions } from './statistics-filters';
import type { StatisticsFocus } from './statistics-navigation';
import { BarChart, formatDkp, moscowDateTime, weekLabel } from './ui/charts';
import { DKP_ENTRY_LABELS } from './ui/profile';
import { Badge, Card, Muted, Notice, SectionTitle, Table, TextLink } from './ui/index';

/**
 * Вкладка «ДКП» (#221, план 2.8): начисления, траты на аукционах и
 * корректировки раздельно со знаками, динамика за период, таблицы
 * игроков/паков/КП с полным балансом на дату среза и раскрытием сумм до
 * операций журнала. Операции «Без ивента» — отдельная категория вне итога
 * выбранного типа/режима. Положительная корректировка не смешивается
 * с заработком.
 */

type DkpCut = 'members' | 'packs' | 'kps';

const CUTS: Array<{ key: DkpCut; label: string }> = [
  { key: 'members', label: 'Игроки' },
  { key: 'packs', label: 'Паки' },
  { key: 'kps', label: 'КП' },
];

/** Знак сохраняется у всех показателей: траты отрицательны. */
function signed(value: number): string {
  return value > 0 ? `+${formatDkp(value)}` : formatDkp(value);
}

function totalBadges(totals: DkpTotals): Array<{ label: string; value: string }> {
  return [
    { label: 'Начислено', value: signed(totals.earned) },
    { label: 'Потрачено на аукционах', value: signed(totals.spent) },
    { label: 'Корректировки', value: signed(totals.adjustments) },
    { label: 'Итого движения', value: signed(totals.net) },
  ];
}

export function StatisticsDkpTab({
  query,
  focus,
  options,
}: {
  query: StatisticsQuery & { from: string; to: string };
  focus: StatisticsFocus | null;
  options: StatisticsFilterOptions | null;
}) {
  const report = useStatisticsEndpoint<DkpStatisticsReport>('/statistics/dkp', query);
  const [cut, setCut] = useState<DkpCut>('members');
  const [expanded, setExpanded] = useState<string | null>(null);

  // Срез показателя из карточки обзора раскрывает таблицы соответствующего вида.
  useEffect(() => {
    if (focus?.kind === 'dkpSection') setCut('members');
  }, [focus]);

  const data = report.data;
  const modeActive = !!query.mode;
  const typeActive = !!query.eventTypeId;
  // Полный баланс не ограничен фильтрами типа/режима — подпись обязательна.
  const ignored = [typeActive ? 'типа ивента' : null, modeActive ? 'PvE–PvP' : null].filter(
    (part): part is string => !!part,
  );
  const balanceNote = `Без учёта фильтра ${ignored.join(typeActive && modeActive ? ' и ' : ' ')}`;

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
          aria-label="Загрузка отчёта ДКП"
          className="h-40 animate-pulse rounded-lg bg-surface-muted"
        />
      </Card>
    );
  }

  const rows =
    cut === 'members'
      ? data.members.map((row) => ({
          id: row.id,
          name: row.nickname,
          totals: row.totals,
          details: row.details,
          balance: row.balance,
        }))
      : (cut === 'packs' ? data.packs : data.kps).map((row) => ({
          id: row.id ?? 'unknown',
          name: row.name ?? 'Нет исторических данных',
          totals: row.totals,
          details: row.details,
          balance: null,
        }));

  return (
    <div className="space-y-4">
      <Card id="dkp-totals">
        <SectionTitle>Движение ДКП за период</SectionTitle>
        <div className="flex flex-wrap gap-2">
          {totalBadges(data.totals).map((item) => (
            <Badge key={item.label} tone="neutral">
              {item.label}: <span className="tabular-nums">{item.value}</span>
            </Badge>
          ))}
        </div>
        <p className="mt-2 text-sm text-secondary">
          Начисления — чек-ин и ручные начисления; корректировки показаны отдельно со знаком и не
          подмешиваются к заработку.
        </p>
      </Card>

      <Card>
        <SectionTitle>Динамика по неделям</SectionTitle>
        <BarChart
          label="Итог движения ДКП по неделям"
          columns={data.weeks.map((week) => ({
            key: week.start,
            label: weekLabel(week.start, week.end),
            value: Math.abs(week.totals.net),
            display: signed(week.totals.net),
            hint: `Начислено ${formatDkp(week.totals.earned)}, потрачено ${formatDkp(week.totals.spent)}, корректировки ${formatDkp(week.totals.adjustments)}`,
          }))}
        />
        <Table className="mt-3">
          <thead>
            <tr>
              <Table.Th>Неделя</Table.Th>
              <Table.Th>Начислено</Table.Th>
              <Table.Th>Потрачено</Table.Th>
              <Table.Th>Корректировки</Table.Th>
              <Table.Th>Итого</Table.Th>
            </tr>
          </thead>
          <tbody>
            {data.weeks.map((week) => (
              <tr key={week.start}>
                <Table.Td className="tabular-nums">{weekLabel(week.start, week.end)}</Table.Td>
                <Table.Td className="tabular-nums">{signed(week.totals.earned)}</Table.Td>
                <Table.Td className="tabular-nums">{signed(week.totals.spent)}</Table.Td>
                <Table.Td className="tabular-nums">{signed(week.totals.adjustments)}</Table.Td>
                <Table.Td className="tabular-nums">{signed(week.totals.net)}</Table.Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>

      <Card id="dkp-tables">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <SectionTitle>Показатели и балансы</SectionTitle>
          <div role="group" aria-label="Разрез ДКП" className="flex flex-wrap gap-2">
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
        {data.balanceIgnoresFilters.length > 0 && (
          <Notice tone="info">
            Баланс на {moscowDateTime(data.balanceAsOf)} — полный, накопительный по всей истории
            выбранных игроков: {balanceNote}.
          </Notice>
        )}
        <Table className="mt-3">
          <thead>
            <tr>
              <Table.Th>{cut === 'members' ? 'Игрок' : 'Команда'}</Table.Th>
              <Table.Th>Начислено</Table.Th>
              <Table.Th>Потрачено</Table.Th>
              <Table.Th>Корректировки</Table.Th>
              <Table.Th>Итого</Table.Th>
              {cut === 'members' && (
                <Table.Th>Баланс на {moscowDateTime(data.balanceAsOf)}</Table.Th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Fragment key={row.id}>
                <Table.Row
                  onClick={() => setExpanded(expanded === row.id ? null : row.id)}
                  aria-expanded={expanded === row.id}
                  aria-label={`Операции: ${row.name}`}
                >
                  <Table.Td className="font-medium">
                    {cut === 'members' ? (
                      <TextLink
                        href={`/profiles/${encodeURIComponent(row.id)}`}
                        onClick={(event) => event.stopPropagation()}
                      >
                        {row.name}
                      </TextLink>
                    ) : (
                      row.name
                    )}
                  </Table.Td>
                  <Table.Td className="tabular-nums">{signed(row.totals.earned)}</Table.Td>
                  <Table.Td className="tabular-nums">{signed(row.totals.spent)}</Table.Td>
                  <Table.Td className="tabular-nums">{signed(row.totals.adjustments)}</Table.Td>
                  <Table.Td className="tabular-nums">{signed(row.totals.net)}</Table.Td>
                  {cut === 'members' && (
                    <Table.Td className="tabular-nums font-semibold">
                      {formatDkp(row.balance ?? 0)}
                    </Table.Td>
                  )}
                </Table.Row>
                {expanded === row.id && (
                  <tr>
                    <td colSpan={6} className="border-b border-line bg-surface-muted p-3">
                      <p className="mb-2 text-sm text-secondary">
                        Операции журнала ({row.details.length})
                      </p>
                      <MovementTable movements={row.details} options={options} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </Table>
        {rows.length === 0 && <Muted>Нет данных за выбранный период</Muted>}
      </Card>

      <Card id="dkp-without-event">
        <SectionTitle>Без ивента</SectionTitle>
        <p className="text-sm text-secondary">
          Самостоятельные операции (лоты хранилища, админ-начисления): без типа и режима, не
          ограничиваются фильтрами и не подмешиваются в итог выбранного типа ивента.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {totalBadges(data.withoutEvent.totals).map((item) => (
            <Badge key={item.label} tone="warning">
              {item.label}: <span className="tabular-nums">{item.value}</span>
            </Badge>
          ))}
        </div>
        <Table className="mt-3">
          <thead>
            <tr>
              <Table.Th>Игрок</Table.Th>
              <Table.Th>Начислено</Table.Th>
              <Table.Th>Потрачено</Table.Th>
              <Table.Th>Корректировки</Table.Th>
              <Table.Th>Итого</Table.Th>
            </tr>
          </thead>
          <tbody>
            {data.withoutEvent.members.map((row) => (
              <Fragment key={row.id}>
                <Table.Row
                  onClick={() => setExpanded(expanded === `we:${row.id}` ? null : `we:${row.id}`)}
                  aria-expanded={expanded === `we:${row.id}`}
                  aria-label={`Операции без ивента: ${row.nickname}`}
                >
                  <Table.Td className="font-medium">{row.nickname}</Table.Td>
                  <Table.Td className="tabular-nums">{signed(row.totals.earned)}</Table.Td>
                  <Table.Td className="tabular-nums">{signed(row.totals.spent)}</Table.Td>
                  <Table.Td className="tabular-nums">{signed(row.totals.adjustments)}</Table.Td>
                  <Table.Td className="tabular-nums">{signed(row.totals.net)}</Table.Td>
                </Table.Row>
                {expanded === `we:${row.id}` && (
                  <tr>
                    <td colSpan={5} className="border-b border-line bg-surface-muted p-3">
                      <MovementTable movements={row.details} options={options} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </Table>
        {data.withoutEvent.members.length === 0 && <Muted>Нет операций без ивента</Muted>}
      </Card>
    </div>
  );
}

/** Раскрытие сумм: операции журнала с типом, датой, суммой и связями. */
function MovementTable({
  movements,
  options,
}: {
  movements: DkpMovement[];
  options: StatisticsFilterOptions | null;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <Table.Th>Тип</Table.Th>
          <Table.Th>Дата</Table.Th>
          <Table.Th>Сумма</Table.Th>
          <Table.Th>Связанный ивент</Table.Th>
          <Table.Th>Лот</Table.Th>
          <Table.Th>Команда на момент ивента</Table.Th>
        </tr>
      </thead>
      <tbody>
        {movements.map((movement) => (
          <tr key={movement.id}>
            <Table.Td>{DKP_ENTRY_LABELS[movement.type] ?? movement.type}</Table.Td>
            <Table.Td className="tabular-nums">{moscowDateTime(movement.occurredAt)}</Table.Td>
            <Table.Td
              className={`tabular-nums ${movement.amount < 0 ? 'text-danger' : 'text-success'}`}
            >
              {signed(movement.amount)}
            </Table.Td>
            <Table.Td>
              {movement.eventId ? (
                <>
                  {movement.eventName ?? movement.eventId}
                  {movement.eventTypeName && (
                    <span className="text-secondary"> · {movement.eventTypeName}</span>
                  )}
                  {movement.mode && (
                    <span className="text-secondary">
                      {' '}
                      · {movement.mode === 'PVE' ? 'PvE' : 'PvP'}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-secondary">без ивента</span>
              )}
            </Table.Td>
            <Table.Td>{movement.auctionItemName ?? movement.auctionId ?? '—'}</Table.Td>
            <Table.Td>{teamOf(movement, options)}</Table.Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

function teamOf(movement: DkpMovement, options: StatisticsFilterOptions | null): string {
  if (movement.teamStatus === 'NO_HISTORICAL_DATA') return 'Нет исторических данных';
  const pack = options?.kps.flatMap((kp) => kp.packs).find((p) => p.id === movement.packId);
  const kp = options?.kps.find((k) => k.id === movement.kpId);
  return [pack?.name ?? 'Без пака', kp?.name].filter(Boolean).join(' · ');
}

'use client';

import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  can,
  canManageEvent,
  type DashboardEvent,
  type LootDropFact,
  type LootStatisticsReport,
  type StatisticsQuery,
} from '@dkp/shared';
import { EventCard } from './event-card';
import { ReportError, useGameTime, useStatisticsEndpoint } from './statistics-report';
import type { StatisticsFilterOptions } from './statistics-filters';
import { csvPath, type StatisticsFocus } from './statistics-navigation';
import { useSession } from './session-context';
import { api } from '../lib/api';
import { CsvButton, formatDkp, moscowDateTime } from './ui/charts';
import { Badge, Card, Muted, SectionTitle, Table, TextLink } from './ui/index';

/**
 * Вкладка «Лут» (#222, план 2.8): переключение «Выпало / Получено» по API #216.
 * Выпадение и получение — разные факты с разными датами; нераспределённый дроп
 * остаётся в «Выпало» и не показывается выданным; дропы и выдачи хранилища —
 * отдельная категория «Без ивента». finalPrice — фактическое списание журнала,
 * текущие наценки/скидки прошлые покупки не пересчитывают.
 */

type LootView = 'dropped' | 'awarded';
type AwardCut = 'members' | 'packs' | 'kps';

const LOT_STATUS_LABELS: Record<string, string> = {
  OPEN: 'Лот ещё разыгрывается',
  CLOSED: 'Лот закрыт',
  CANCELLED: 'Лот отменён',
};

export function StatisticsLootTab({
  query,
  focus,
  options,
}: {
  query: StatisticsQuery & { from: string; to: string };
  focus: StatisticsFocus | null;
  options: StatisticsFilterOptions | null;
}) {
  const report = useStatisticsEndpoint<LootStatisticsReport>('/statistics/loot', query);
  const [view, setView] = useState<LootView>('dropped');
  const [expandedItem, setExpandedItem] = useState<string | null>(null);
  const [awardCut, setAwardCut] = useState<AwardCut>('members');
  const gameTime = useGameTime();
  const { user } = useSession();
  const [openEvent, setOpenEvent] = useState<DashboardEvent | null>(null);
  const [eventError, setEventError] = useState(false);

  // Срезы обзора: предмет раскрывает строку «Выпало», представление — выбирает его.
  useEffect(() => {
    if (focus?.kind === 'lootView') setView(focus.view);
  }, [focus]);
  useEffect(() => {
    if (focus?.kind === 'lootItem') {
      setView('dropped');
      setExpandedItem(focus.itemId);
    }
  }, [focus]);

  const data = report.data;
  const droppedItems = useMemo(
    () =>
      data
        ? focus?.kind === 'lootItem'
          ? data.dropped.items.filter((row) => row.itemId === focus.itemId)
          : data.dropped.items
        : [],
    [data, focus],
  );

  // Обе выгрузки «Выпало» несут срез предмета (#263): сервер сужает таблицы
  // до него, доли остаются от всей выборки — как в срезе интерфейса.
  const itemQuery =
    focus?.kind === 'lootItem' ? { ...query, itemId: focus.itemId } : query;

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
          aria-label="Загрузка отчёта лута"
          className="h-40 animate-pulse rounded-lg bg-surface-muted"
        />
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div role="group" aria-label="Представление лута" className="flex flex-wrap gap-2">
        {(
          [
            { key: 'dropped', label: 'Выпало' },
            { key: 'awarded', label: 'Получено' },
          ] as const
        ).map((item) => (
          <button
            key={item.key}
            type="button"
            aria-pressed={view === item.key}
            onClick={() => setView(item.key)}
            className={`rounded-lg border px-3 py-1 text-sm ${
              view === item.key
                ? 'border-accent bg-accent-soft text-accent'
                : 'border-line bg-surface text-primary hover:bg-surface-muted'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-secondary">
        {view === 'dropped'
          ? '«Выпало» — факты выпадения за период по дате выпадения. Выпавший, но ещё не распределённый предмет остаётся здесь и не означает покупку.'
          : '«Получено» — фактические выдачи по дате выдачи; цена — фактическое списание журнала, без пересчёта по текущим наценкам и скидкам.'}
      </p>

      {view === 'dropped' ? (
        <>
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <SectionTitle className="mb-0">Выпавшие предметы</SectionTitle>
              <span className="flex flex-wrap gap-2">
                <CsvButton
                  path={csvPath('loot', { table: 'dropped' }, itemQuery)}
                  label="выпавшие предметы"
                />
                <CsvButton
                  path={csvPath('loot', { table: 'dropped-details' }, itemQuery)}
                  label="факты выпадений"
                />
              </span>
            </div>
            <p className="text-sm text-secondary">
              Всего выпадений: {data.dropped.totals.drops} · разных предметов:{' '}
              {data.dropped.totals.items}. Доля — от всех выпадений выборки.
            </p>
            <Table className="mt-3">
              <thead>
                <tr>
                  <Table.Th>Предмет</Table.Th>
                  <Table.Th>Количество</Table.Th>
                  <Table.Th>Доля выпадений</Table.Th>
                </tr>
              </thead>
              <tbody>
                {droppedItems.map((row) => (
                  <Fragment key={row.itemId}>
                    <Table.Row
                      onClick={() =>
                        setExpandedItem(expandedItem === row.itemId ? null : row.itemId)
                      }
                      aria-expanded={expandedItem === row.itemId}
                      aria-label={`Детали выпадений: ${row.itemName}`}
                    >
                      <Table.Td className="font-medium">
                        {row.itemName}
                        {row.isArchboss && (
                          <Badge tone="warning" className="ml-2">
                            Архибосс
                          </Badge>
                        )}
                        {row.rarity && <span className="ml-2 text-secondary">{row.rarity}</span>}
                      </Table.Td>
                      <Table.Td className="tabular-nums">{row.count}</Table.Td>
                      <Table.Td className="tabular-nums">{row.sharePct}%</Table.Td>
                    </Table.Row>
                    {expandedItem === row.itemId && (
                      <tr>
                        <td colSpan={3} className="border-b border-line bg-surface-muted p-3">
                          <DropDetails
                            details={row.details}
                            onOpenEvent={openEventCard}
                            options={options}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </Table>
            {droppedItems.length === 0 && <Muted>Нет данных за выбранный период</Muted>}
          </Card>
          <WithoutEventDrops report={data} query={query} />
        </>
      ) : (
        <>
          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <SectionTitle className="mb-0">Выдачи</SectionTitle>
              <CsvButton path={csvPath('loot', { table: 'awarded' }, query)} label="выдачи лута" />
            </div>
            <p className="text-sm text-secondary">
              Получено предметов: {data.awarded.totals.awards} · сумма фактических цен:{' '}
              {formatDkp(data.awarded.totals.spent)} ДКП.
            </p>
            {eventError && <Muted>Не удалось открыть ивент</Muted>}
            <Table className="mt-3">
              <thead>
                <tr>
                  <Table.Th>Получатель</Table.Th>
                  <Table.Th>Предмет</Table.Th>
                  <Table.Th>Ивент / лот</Table.Th>
                  <Table.Th>Дата получения</Table.Th>
                  <Table.Th>Фактическая цена</Table.Th>
                </tr>
              </thead>
              <tbody>
                {data.awarded.awards.map((award) => (
                  <tr key={award.id}>
                    <Table.Td className="font-medium">
                      <TextLink href={`/profiles/${encodeURIComponent(award.memberId)}`}>
                        {award.nickname}
                      </TextLink>
                    </Table.Td>
                    <Table.Td>
                      {award.itemName}
                      {award.isArchboss && (
                        <Badge tone="warning" className="ml-2">
                          Архибосс
                        </Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {award.eventId ? (
                        <button
                          type="button"
                          className="text-accent underline"
                          onClick={() => void openEventCard(award.eventId!)}
                        >
                          {award.eventName ?? award.eventId}
                        </button>
                      ) : (
                        <span className="text-secondary">Без ивента</span>
                      )}
                      {' · '}
                      <TextLink href="/auction">лот</TextLink>
                    </Table.Td>
                    <Table.Td className="tabular-nums">{moscowDateTime(award.occurredAt)}</Table.Td>
                    <Table.Td className="tabular-nums">{formatDkp(award.finalPrice)} ДКП</Table.Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            {data.awarded.awards.length === 0 && <Muted>Нет данных за выбранный период</Muted>}
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <SectionTitle className="mb-0">Итоги по получателям</SectionTitle>
              <div className="flex flex-wrap items-center gap-2">
                <CsvButton
                  path={csvPath('loot', { table: `awarded-${awardCut}` }, query)}
                  label={`итоги полученного: ${awardCut === 'members' ? 'игроки' : awardCut === 'packs' ? 'паки' : 'КП'}`}
                />
                <div
                  role="group"
                  aria-label="Разрез полученного лута"
                  className="flex flex-wrap gap-2"
                >
                  {(
                    [
                      { key: 'members', label: 'Игроки' },
                      { key: 'packs', label: 'Паки' },
                      { key: 'kps', label: 'КП' },
                    ] as const
                  ).map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      aria-pressed={awardCut === item.key}
                      onClick={() => setAwardCut(item.key)}
                      className={`rounded-lg border px-3 py-1 text-sm ${
                        awardCut === item.key
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
            <AwardTotals
              rows={
                awardCut === 'members'
                  ? data.awarded.members.map((row) => ({
                      id: row.id,
                      name: row.nickname,
                      totals: row.totals,
                    }))
                  : (awardCut === 'packs' ? data.awarded.packs : data.awarded.kps).map((row) => ({
                      id: row.id ?? 'unknown',
                      name: row.name ?? 'Нет исторических данных',
                      totals: row.totals,
                    }))
              }
              cut={awardCut}
            />
          </Card>

          <Card>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <SectionTitle className="mb-0">Получено без ивента</SectionTitle>
              <CsvButton
                path={csvPath('loot', { table: 'without-event-awarded' }, query)}
                label="получено без ивента"
              />
            </div>
            <p className="text-sm text-secondary">
              Выдачи лотов хранилища гильдии: без команды и без типа ивента, фильтрами не
              ограничиваются.
            </p>
            {data.awarded.withoutEvent.members.length === 0 ? (
              <Muted>Нет выдач без ивента</Muted>
            ) : (
              <Table className="mt-3">
                <thead>
                  <tr>
                    <Table.Th>Получатель</Table.Th>
                    <Table.Th>Предметов</Table.Th>
                    <Table.Th>Сумма фактических цен</Table.Th>
                  </tr>
                </thead>
                <tbody>
                  {data.awarded.withoutEvent.members.map((row) => (
                    <tr key={row.id}>
                      <Table.Td className="font-medium">{row.nickname}</Table.Td>
                      <Table.Td className="tabular-nums">{row.totals.awards}</Table.Td>
                      <Table.Td className="tabular-nums">
                        {formatDkp(row.totals.spent)} ДКП
                      </Table.Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        </>
      )}

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

/** Детали выпадений предмета: ивент на дату дропа, команда, статус лота. */
function DropDetails({
  details,
  onOpenEvent,
  options,
}: {
  details: LootDropFact[];
  onOpenEvent: (eventId: string) => void;
  options: StatisticsFilterOptions | null;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <Table.Th>Дата выпадения</Table.Th>
          <Table.Th>Ивент</Table.Th>
          <Table.Th>Команда ивента</Table.Th>
          <Table.Th>Лот</Table.Th>
        </tr>
      </thead>
      <tbody>
        {details.map((detail) => (
          <tr key={detail.id}>
            <Table.Td className="tabular-nums">{moscowDateTime(detail.occurredAt)}</Table.Td>
            <Table.Td>
              {detail.eventId ? (
                <button
                  type="button"
                  className="text-accent underline"
                  onClick={() => onOpenEvent(detail.eventId!)}
                >
                  {detail.eventName ?? detail.eventId}
                </button>
              ) : (
                <span className="text-secondary">Без ивента (хранилище)</span>
              )}
            </Table.Td>
            <Table.Td>{teamOfDrop(detail, options)}</Table.Td>
            <Table.Td>
              {detail.lotId ? (
                <>
                  <TextLink href="/auction">лот</TextLink>
                  {detail.lotStatus && (
                    <span className="ml-2 text-secondary">
                      {LOT_STATUS_LABELS[detail.lotStatus] ?? detail.lotStatus}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-secondary">не выставлялся</span>
              )}
            </Table.Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Историческая команда на дату дропа (область ивента КП/пака). */
function teamOfDrop(detail: LootDropFact, options: StatisticsFilterOptions | null): string {
  if (detail.teamStatus === 'NO_HISTORICAL_DATA') return 'Нет исторических данных';
  const pack = options?.kps.flatMap((kp) => kp.packs).find((p) => p.id === detail.packId);
  const kp = options?.kps.find((k) => k.id === detail.kpId);
  return [pack?.name ?? 'Без пака', kp?.name].filter(Boolean).join(' · ');
}

function WithoutEventDrops({
  report,
  query,
}: {
  report: LootStatisticsReport;
  query: StatisticsQuery;
}) {
  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <SectionTitle className="mb-0">Выпало без ивента</SectionTitle>
        <CsvButton
          path={csvPath('loot', { table: 'without-event-dropped' }, query)}
          label="выпало без ивента"
        />
      </div>
      <p className="text-sm text-secondary">
        Дропы хранилища гильдии: без типа, режима и команды, фильтрами не ограничиваются и в топ
        выпадений не входят.
      </p>
      {report.dropped.withoutEvent.items.length === 0 ? (
        <Muted>Нет выпадений без ивента</Muted>
      ) : (
        <Table className="mt-3">
          <thead>
            <tr>
              <Table.Th>Предмет</Table.Th>
              <Table.Th>Количество</Table.Th>
            </tr>
          </thead>
          <tbody>
            {report.dropped.withoutEvent.items.map((row) => (
              <tr key={row.itemId}>
                <Table.Td className="font-medium">{row.itemName}</Table.Td>
                <Table.Td className="tabular-nums">{row.count}</Table.Td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

function AwardTotals({
  rows,
  cut,
}: {
  rows: Array<{ id: string; name: string; totals: { awards: number; spent: number } }>;
  cut: AwardCut;
}) {
  return (
    <Table>
      <thead>
        <tr>
          <Table.Th>{cut === 'members' ? 'Получатель' : 'Команда'}</Table.Th>
          <Table.Th>Предметов</Table.Th>
          <Table.Th>Сумма фактических цен</Table.Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.id}>
            <Table.Td className="font-medium">
              {cut === 'members' ? (
                <TextLink href={`/profiles/${encodeURIComponent(row.id)}`}>{row.name}</TextLink>
              ) : (
                row.name
              )}
            </Table.Td>
            <Table.Td className="tabular-nums">{row.totals.awards}</Table.Td>
            <Table.Td className="tabular-nums">{formatDkp(row.totals.spent)} ДКП</Table.Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

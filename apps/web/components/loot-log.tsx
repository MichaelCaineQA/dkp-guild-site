'use client';

import { useCallback, useEffect, useState } from 'react';
import type { LootLogPage, LootLogRow } from '@dkp/shared';
import { api } from '../lib/api';
import { Badge, Button, Card, ErrorText, Field, Muted, SectionTitle, Select, Table } from './ui';

interface MemberRow {
  id: string;
  nickname: string;
}

/** Событие для фильтра: /events возвращает EventRow. */
interface EventOption {
  id: string;
  name: string;
  startsAt: string;
}

interface ItemOption {
  id: string;
  name: string;
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Ссылка «всё полученное игроком» из профиля: ?loot-member=<id>. */
function initialMemberFilter(): string {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('loot-member') ?? '';
}

/**
 * Лут-лог (issue #99, план 2.4/2.9): публичная история полученного лута —
 * кто что взял и за сколько. Только фактические выдачи: отменённые лоты
 * и лоты без выдачи здесь не представлены. Фильтры по игроку, событию
 * и предмету работают по одному и в сочетании.
 */
export function LootLog({ initialMember = initialMemberFilter() }: { initialMember?: string }) {
  const [page, setPage] = useState<LootLogPage | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [events, setEvents] = useState<EventOption[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [memberFilter, setMemberFilter] = useState(initialMember);
  const [eventFilter, setEventFilter] = useState('');
  const [itemFilter, setItemFilter] = useState('');
  const [offset, setOffset] = useState(0);
  const LIMIT = 50;

  useEffect(() => {
    void Promise.all([
      api<MemberRow[]>('/members'),
      api<EventOption[]>('/events'),
      api<ItemOption[]>('/items'),
    ])
      .then(([membersData, eventsData, itemsData]) => {
        setMembers(membersData);
        // свежие события сверху — удобнее выбирать в фильтре
        eventsData.sort((a, b) => Date.parse(b.startsAt) - Date.parse(a.startsAt));
        setEvents(eventsData);
        setItems(itemsData);
      })
      .catch(() => setError('Не удалось загрузить данные для фильтров'));
  }, []);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
      if (memberFilter) params.set('memberId', memberFilter);
      if (eventFilter) params.set('eventId', eventFilter);
      if (itemFilter) params.set('itemId', itemFilter);
      setPage(await api<LootLogPage>(`/auctions/loot-log?${params}`));
      setError(null);
    } catch {
      setError('Не удалось загрузить лут-лог');
      setPage({ entries: [], total: 0 });
    }
  }, [memberFilter, eventFilter, itemFilter, offset]);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = page?.entries ?? [];
  const total = page?.total ?? 0;
  const hasFilters = !!(memberFilter || eventFilter || itemFilter);

  return (
    <Card>
      <SectionTitle>Лут-лог</SectionTitle>
      <p className="mb-3 text-sm text-secondary">
        Кто что взял и за сколько. Стоимость — фактическая запись журнала ДКП; исправления не
        переписывают журнал.
      </p>
      {error && <ErrorText>{error}</ErrorText>}

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Field label="Игрок:">
          <Select
            value={memberFilter}
            onChange={(e) => {
              setMemberFilter(e.target.value);
              setOffset(0);
            }}
            aria-label="Фильтр по игроку"
          >
            <option value="">все</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nickname}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Событие:">
          <Select
            value={eventFilter}
            onChange={(e) => {
              setEventFilter(e.target.value);
              setOffset(0);
            }}
            aria-label="Фильтр по событию"
          >
            <option value="">все</option>
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Предмет:">
          <Select
            value={itemFilter}
            onChange={(e) => {
              setItemFilter(e.target.value);
              setOffset(0);
            }}
            aria-label="Фильтр по предмету"
          >
            <option value="">все</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
        </Field>
        {hasFilters && (
          <Button
            onClick={() => {
              setMemberFilter('');
              setEventFilter('');
              setItemFilter('');
              setOffset(0);
            }}
          >
            Сбросить
          </Button>
        )}
        {page && (
          <>
            <Muted>
              {total === 0 ? 0 : offset + 1}–{Math.min(offset + LIMIT, total)} из {total}
            </Muted>
            <Button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
              ←
            </Button>
            <Button disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>
              →
            </Button>
          </>
        )}
      </div>

      <Table>
        <thead>
          <tr>
            <Table.Th>Когда</Table.Th>
            <Table.Th>Предмет</Table.Th>
            <Table.Th>Получатель</Table.Th>
            <Table.Th>Событие</Table.Th>
            <Table.Th>Стоимость</Table.Th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <LootRow key={row.awardId} row={row} />
          ))}
          {rows.length === 0 && (
            <tr>
              <Table.Td colSpan={5}>
                <Muted>
                  {hasFilters ? 'По этим фильтрам лута нет' : 'Лута пока нет — выдачи появятся после завершения лотов'}
                </Muted>
              </Table.Td>
            </tr>
          )}
        </tbody>
      </Table>
    </Card>
  );
}

function LootRow({ row }: { row: LootLogRow }) {
  return (
    <tr>
      <Table.Td className="whitespace-nowrap">{formatDateTime(row.createdAt)}</Table.Td>
      <Table.Td className="font-medium">
        {row.itemName}
        {row.rarity && (
          <>
            {' '}
            <Badge tone="neutral">{row.rarity}</Badge>
          </>
        )}
      </Table.Td>
      <Table.Td>
        <a
          className="text-accent hover:underline"
          href={`/profiles/${encodeURIComponent(row.winnerId)}`}
        >
          {row.winnerName}
        </a>
      </Table.Td>
      <Table.Td>{row.eventName}</Table.Td>
      <Table.Td className="tabular-nums font-semibold">
        {row.finalPrice}
        {row.markupPct > 0 && (
          <>
            {' '}
            <Badge tone="warning" title="Наценка «чужому» классу">
              +{row.markupPct}%
            </Badge>
          </>
        )}
      </Table.Td>
    </tr>
  );
}

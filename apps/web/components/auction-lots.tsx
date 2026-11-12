'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  bidFullCost,
  isForeignBidder,
  minBidAmount,
  formatTargetRoles,
  ITEM_TARGET_ROLE_LABELS,
  LOT_STATUS_LABELS,
  type AuctionListRow,
  type AuctionListStatus,
  type CombatRole,
  type LotTimerKind,
} from '@dkp/shared';
import { api } from '../lib/api';
import { useAuctionLot } from '../lib/use-auction-lot';
import { CreateLotDialog } from './create-lot-dialog';
import { Badge, Button, Card, ErrorText, Input, Modal, Muted, SectionTitle, Table } from './ui';

type StatusTab = AuctionListStatus;

const STATUS_TABS: Array<[StatusTab, string]> = [
  ['OPEN', 'Открытые'],
  ['CLOSED', 'Завершённые'],
  ['CANCELLED', 'Отменённые'],
];

const TIMER_KIND_LABELS: Record<LotTimerKind, string> = {
  FIRST_BID: 'Живая раздача',
  OPENING: 'Длинный лот',
};

/** Остаток времени лота: единое серверное время + локальный тик. */
function useCountdown(endsAt: string | null, serverTime: string | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!endsAt || !serverTime) return null;
  // смещение часов браузера относительно сервера — из среза/события
  const offset = Date.parse(serverTime) - now;
  const remaining = Date.parse(endsAt) - (now + offset);
  if (remaining <= 0) return '00:00';
  const totalSec = Math.ceil(remaining / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function formatTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

function errorMessage(error: unknown, fallback: string): string {
  const body = (error as { body?: { message?: string | string[] } }).body;
  const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
  return message ?? fallback;
}

/**
 * Лоты аукциона (issue #98, план 2.4/6 п. 10): вкладки открытых,
 * завершённых и отменённых лотов; карточка лота со ставками, таймером
 * и формой ставки обновляется в реальном времени (#97). Глава/Админ
 * создаёт здесь лот вне ивента — «хранилище гильдии» (#137).
 */
export function AuctionLots({
  viewerMemberId,
  viewerRole,
  canCreateLot = false,
}: {
  viewerMemberId: string | null;
  viewerRole: CombatRole | null;
  /** Глава/Админ: кнопка «Создать лот» — лот без ивента (#137). */
  canCreateLot?: boolean;
}) {
  const [status, setStatus] = useState<StatusTab>('OPEN');
  const [rows, setRows] = useState<AuctionListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AuctionListRow | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async (tab: StatusTab) => {
    try {
      setRows(await api<AuctionListRow[]>(`/auctions?status=${tab}`));
      setError(null);
    } catch {
      setError('Не удалось загрузить лоты');
      setRows([]);
    }
  }, []);

  useEffect(() => {
    setRows(null);
    void load(status);
  }, [status, load]);

  // лот закрылся в realtime — обновляем список фоновой вкладки
  useEffect(() => {
    if (!selected) return;
    if (selected.status !== 'OPEN') return;
    void load(status);
  }, [selected, status, load]);

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <SectionTitle>Лоты</SectionTitle>
        <div className="flex flex-wrap items-center gap-2">
          {canCreateLot && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              Создать лот
            </Button>
          )}
          <div className="flex gap-2" role="tablist" aria-label="Состояния лотов">
            {STATUS_TABS.map(([key, label]) => (
              <Button key={key} onClick={() => setStatus(key)} aria-pressed={status === key}>
                {label}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {error && <ErrorText>{error}</ErrorText>}
      {rows === null ? (
        <Muted>Загрузка…</Muted>
      ) : rows.length === 0 ? (
        <Muted>
          {status === 'OPEN'
            ? 'Открытых лотов нет — торги появятся, когда управляющие ивентов создадут лоты.'
            : status === 'CLOSED'
              ? 'Завершённых лотов пока нет.'
              : 'Отменённых лотов пока нет.'}
        </Muted>
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((row) => (
            <li key={row.id}>
              <LotCard row={row} onOpen={() => setSelected(row)} />
            </li>
          ))}
        </ul>
      )}

      {selected && (
        <LotModal
          row={selected}
          viewerMemberId={viewerMemberId}
          viewerRole={viewerRole}
          onClose={() => setSelected(null)}
        />
      )}

      {creating && (
        <CreateLotDialog
          onClose={() => setCreating(false)}
          onCreated={() => void load(status)}
        />
      )}
    </Card>
  );
}

function LotCard({ row, onOpen }: { row: AuctionListRow; onOpen: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-(--border) p-3">
      <div className="flex flex-col gap-1">
        <span className="font-medium">
          {row.itemName}{' '}
          {row.rarity && (
            <Badge tone="neutral">{row.rarity}</Badge>
          )}{' '}
          <Badge tone={row.status === 'OPEN' ? 'accent' : 'neutral'}>
            {LOT_STATUS_LABELS[row.status]}
          </Badge>
        </span>
        <Muted>
          Кому нужна: {formatTargetRoles(row.targetRoles)}
          {row.timerKind === 'FIRST_BID' && !row.firstBidAt
            ? ' · таймер от первой ставки'
            : row.endsAt
              ? ` · до ${formatTime(row.endsAt)}`
              : ''}
        </Muted>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          {row.status === 'OPEN' ? (
            row.topBid ? (
              <>
                <div className="tabular-nums">{row.topBid.amount} ДКП</div>
                <Muted>ведёт {row.topBid.memberName}</Muted>
              </>
            ) : (
              <Muted>старт {row.startPrice} ДКП</Muted>
            )
          ) : row.winner ? (
            <>
              <div className="tabular-nums">{row.winner.finalPrice} ДКП</div>
              <Muted>получил {row.winner.memberName}</Muted>
            </>
          ) : (
            <Muted>{row.status === 'CANCELLED' ? 'отменён' : 'без победителя'}</Muted>
          )}
        </div>
        <Button onClick={onOpen}>Открыть</Button>
      </div>
    </div>
  );
}

function LotModal({
  row,
  viewerMemberId,
  viewerRole,
  onClose,
}: {
  row: AuctionListRow;
  viewerMemberId: string | null;
  viewerRole: CombatRole | null;
  onClose: () => void;
}) {
  const { state, connection } = useAuctionLot(row.id);
  const lot = state?.lot ?? null;
  const bids = state?.bids ?? null;
  const winner = state?.winner ?? null;
  const countdown = useCountdown(lot?.endsAt ?? null, state?.serverTime ?? null);
  const status = lot?.status ?? row.status;

  return (
    <Modal title={`Лот: ${row.itemName}`} onClose={onClose}>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status === 'OPEN' ? 'accent' : 'neutral'}>{LOT_STATUS_LABELS[status]}</Badge>
          {row.rarity && <Badge tone="neutral">{row.rarity}</Badge>}
          <Badge tone={row.targetRoles.includes('ALL') ? 'neutral' : 'accent'}>
            Кому нужна: {formatTargetRoles(row.targetRoles)}
          </Badge>
          {row.myPreferred && row.discountPct > 0 && (
            <Badge tone="accent">Ваш предпочитаемый — скидка {row.discountPct}%</Badge>
          )}
          {connection.status === 'connecting' && state && <Muted>Переподключение…</Muted>}
        </div>

        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
          <Detail label="Формат" value={TIMER_KIND_LABELS[row.timerKind]} />
          <Detail label="Стартовая цена" value={`${row.startPrice} ДКП`} />
          <Detail label="Шаг ставки" value={`${row.step} ДКП`} />
          <Detail
            label="Наценка «чужим»"
            value={row.markupPct > 0 ? `+${row.markupPct}%` : 'нет'}
          />
          <Detail label="Скидка за предмет" value={row.discountPct > 0 ? `−${row.discountPct}%` : 'нет'} />
          <Detail label="Анти-снайп" value={`${row.antiSnipeSec} с (+${row.antiSnipeExtendSec} с)`} />
          <Detail
            label="Класс предмета"
            value={
              row.targetRoles.includes('ALL')
                ? 'родной всем'
                : viewerRole && row.targetRoles.includes(viewerRole)
                  ? `родной вам (${ITEM_TARGET_ROLE_LABELS[viewerRole]})`
                  : `чужой (наценка +${row.markupPct}%)`
            }
          />
        </dl>

        {status === 'OPEN' ? (
          <>
            <div>
              {row.timerKind === 'FIRST_BID' && (bids === null || bids.length === 0) ? (
                <Muted>
                  Таймер стартует с первой ставки; без ставок лот закроется через{' '}
                  {row.noBidTimeoutSec ? Math.round(row.noBidTimeoutSec / 60) : '—'} мин.
                </Muted>
              ) : countdown ? (
                <div className="text-lg font-medium tabular-nums">До конца торгов: {countdown}</div>
              ) : (
                <Muted>Ожидание таймера…</Muted>
              )}
            </div>
            <CurrentBid
              topBid={bids && bids.length ? bids[bids.length - 1]! : null}
              myMemberId={viewerMemberId}
            />
          </>
        ) : status === 'CLOSED' ? (
          winner ? (
            <div>
              Торги завершены: предмет получил <strong>{winner.memberName}</strong> за{' '}
              <span className="tabular-nums">{winner.finalPrice} ДКП</span>
              {winner.markupPct > 0 && ` (с наценкой ${winner.markupPct}%)`}
              {winner.discountPct > 0 && ` (со скидкой ${winner.discountPct}%)`}.
            </div>
          ) : (
            <div>Торги завершены без победителя — предмет остаётся в гильдии.</div>
          )
        ) : (
          <div>Лот отменён управляющим ивента.</div>
        )}

        {status === 'OPEN' && viewerMemberId && (
          <BidForm
            lotId={row.id}
            startPrice={row.startPrice}
            step={row.step}
            markupPct={row.markupPct}
            discountPct={row.myPreferred ? row.discountPct : 0}
            targetRoles={row.targetRoles}
            topAmount={bids && bids.length > 0 ? bids[bids.length - 1]!.amount : null}
            viewerRole={viewerRole}
          />
        )}
        {status === 'OPEN' && !viewerMemberId && (
          <Muted>Ставки доступны членам гильдии с привязанным профилем.</Muted>
        )}

        <div>
          <SectionTitle>История ставок</SectionTitle>
          {bids === null ? (
            <Muted>Загрузка…</Muted>
          ) : bids.length === 0 ? (
            <Muted>Ставок пока нет — будете первым.</Muted>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Table.Th>Участник</Table.Th>
                  <Table.Th>Сумма</Table.Th>
                  <Table.Th>Полная стоимость</Table.Th>
                  <Table.Th>Время</Table.Th>
                </tr>
              </thead>
              <tbody>
                {[...bids].reverse().map((bid) => (
                  <tr key={bid.id}>
                    <Table.Td className="font-medium">{bid.memberName}</Table.Td>
                    <Table.Td className="tabular-nums">{bid.amount}</Table.Td>
                    <Table.Td className="tabular-nums">
                      {bid.fullCost}
                      {bid.markupPct > 0 && <Muted> (+{bid.markupPct}%)</Muted>}
                      {bid.discountPct > 0 && <Muted> (−{bid.discountPct}%)</Muted>}
                    </Table.Td>
                    <Table.Td>{new Date(bid.createdAt).toLocaleTimeString('ru-RU')}</Table.Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </div>
      </div>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt>
        <Muted>{label}</Muted>
      </dt>
      <dd>{value}</dd>
    </div>
  );
}

function CurrentBid({
  topBid,
  myMemberId,
}: {
  topBid: { amount: number; fullCost: number; memberName: string; memberId: string } | null;
  myMemberId: string | null;
}) {
  if (!topBid) return <Muted>Ставок пока нет — минимальная первая ставка на экране формы.</Muted>;
  return (
    <div>
      Текущая ставка: <span className="tabular-nums">{topBid.amount} ДКП</span> —{' '}
      <strong>{topBid.memberName}</strong>
      {myMemberId === topBid.memberId && ' (вы ведёте)'}
    </div>
  );
}

function BidForm({
  lotId,
  startPrice,
  step,
  markupPct,
  discountPct,
  targetRoles,
  topAmount,
  viewerRole,
}: {
  lotId: string;
  startPrice: number;
  step: number;
  markupPct: number;
  /** Скидка за предпочитаемый предмет, если предмет лота — ваш (решение 18). */
  discountPct: number;
  targetRoles: AuctionListRow['targetRoles'];
  /** Ведущая сумма живой ставки — минимум растёт realtime. */
  topAmount: number | null;
  viewerRole: CombatRole | null;
}) {
  const min = minBidAmount({ startPrice, step }, topAmount);
  const [amount, setAmount] = useState(String(min));
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [placed, setPlaced] = useState(false);
  const lastMin = useRef(min);

  // минимальная ставка растёт с перебиванием — подтягиваем поле
  useEffect(() => {
    if (min !== lastMin.current) {
      lastMin.current = min;
      setAmount(String(min));
      setPlaced(false);
    }
  }, [min]);

  const foreign = isForeignBidder(targetRoles, viewerRole);
  const parsed = Number(amount);
  const valid = Number.isInteger(parsed) && parsed >= min;
  const fullCost = valid ? bidFullCost(parsed, markupPct, foreign, discountPct) : null;

  const submit = async () => {
    setSubmitting(true);
    setFormError(null);
    setPlaced(false);
    try {
      await api(`/auctions/${lotId}/bids`, {
        method: 'POST',
        body: JSON.stringify({ amount: parsed }),
      });
      setPlaced(true); // подтверждение видно, пока сокет не обновит историю
    } catch (error) {
      setFormError(errorMessage(error, 'Не удалось сделать ставку'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col gap-2 rounded border border-(--border) p-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span>
            <Muted>Ваша ставка (мин. {min} ДКП)</Muted>
          </span>
          <Input
            type="number"
            value={amount}
            min={min}
            onChange={(e) => setAmount(e.target.value)}
            aria-label="Сумма ставки"
            className="w-32"
          />
        </label>
        <Button onClick={() => void submit()} disabled={submitting || !valid}>
          {submitting ? 'Отправка…' : 'Сделать ставку'}
        </Button>
        {fullCost !== null && (
          <Muted>
            Итоговая стоимость
            {foreign && markupPct > 0 ? ` с наценкой ${markupPct}%` : ''}
            {discountPct > 0 ? ` со скидкой ${discountPct}%` : ''}:{' '}
            <span className="tabular-nums">{fullCost} ДКП</span>
          </Muted>
        )}
      </div>
      {formError && <ErrorText>{formError}</ErrorText>}
      {placed && !formError && <Muted>Ставка принята.</Muted>}
    </div>
  );
}

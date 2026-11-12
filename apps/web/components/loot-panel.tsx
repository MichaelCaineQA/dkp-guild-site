'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  assignWinnerSchema,
  cancelLotSchema,
  closeLotEarlySchema,
  createLotSchema,
  extendLotSchema,
  formatTargetRoles,
  LOT_MANAGE_LIMITS,
  LOT_STATUS_LABELS,
  type ItemRow,
  type LootDropRow,
  type LotDefaults,
  type LotManageResult,
  type LotStatus,
} from '@dkp/shared';
import { api } from '../lib/api';
import { createRequestId } from '../lib/request-id';
import {
  LotParamsFields,
  lotParamsFromDefaults,
  lotParamsPayload,
  type LotParamsState,
} from './lot-params-fields';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Modal,
  Muted,
  Notice,
  SectionTitle,
  Select,
  Table,
} from './ui';

interface LotFormState extends LotParamsState {
  drop: LootDropRow;
  defaults: LotDefaults;
}

/** Ручное действие с лотом (issue #96): вид и лот, с которым работаем. */
type ManageKind = 'extend' | 'cancel' | 'close' | 'award';

interface ManageState {
  kind: ManageKind;
  lotId: string;
  itemName: string;
  lotStatus: LotStatus;
}

function errorMessage(error: unknown, fallback: string): string {
  const body = (error as { body?: { message?: string | string[] } }).body;
  const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
  return message ?? fallback;
}

function formatDuration(lot: NonNullable<LootDropRow['lot']>): string {
  if (lot.durationSec % 86_400 === 0) return `${lot.durationSec / 86_400} дн`;
  if (lot.durationSec % 60 === 0) return `${lot.durationSec / 60} мин`;
  return `${lot.durationSec} сек`;
}

/**
 * «Дроп и лоты» на странице проведения (issue #93 и #96, план 2.4/6):
 * управляющий ивента фиксирует выпавший предмет из справочника, создаёт
 * открытый лот и управляет им — продлевает и отменяет; Глава/Админ досрочно
 * завершает торги и назначает победителя вручную. Ручные действия требуют
 * причину и видны только тем, кто вправе их выполнить (план 2.6, 6, п. 8).
 * Лоты продолжают торги независимо от статуса ивента (план 2.4), поэтому
 * действия доступны и после его завершения.
 */
export function LootPanel({
  eventId,
  canEdit,
  canManage = false,
  canDecide = false,
}: {
  eventId: string;
  canEdit: boolean;
  /** Управляющий ивента: продление и отмена лотов (план 6, п. 8). */
  canManage?: boolean;
  /** Глава/Админ: досрочное завершение и ручной победитель (план 6, п. 8). */
  canDecide?: boolean;
}) {
  const [drops, setDrops] = useState<LootDropRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [members, setMembers] = useState<Array<{ id: string; nickname: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<LotFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [manage, setManage] = useState<ManageState | null>(null);
  const [manageValues, setManageValues] = useState({ minutes: '5', winnerId: '', price: '0' });
  const [manageReason, setManageReason] = useState('');
  const [manageError, setManageError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [lootRows, itemRows] = await Promise.all([
        api<LootDropRow[]>(`/events/${eventId}/loot`),
        api<ItemRow[]>('/items'),
      ]);
      setDrops(lootRows);
      setItems(itemRows);
      setError(null);
    } catch {
      setError('Не удалось загрузить дроп и лоты');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    void load();
  }, [load]);

  const recordDrop = async () => {
    if (!selectedItemId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api(`/events/${eventId}/loot/drops`, {
        method: 'POST',
        body: JSON.stringify({ itemId: selectedItemId }),
      });
      setNotice('Дроп зафиксирован');
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Не удалось зафиксировать дроп'));
    } finally {
      setBusy(false);
    }
  };

  const openLotForm = async (drop: LootDropRow) => {
    setFormError(null);
    try {
      const defaults = await api<LotDefaults>(`/events/${eventId}/loot/defaults/${drop.itemId}`);
      setForm({ drop, defaults, ...lotParamsFromDefaults('FIRST_BID', defaults) });
    } catch (err) {
      setError(errorMessage(err, 'Не удалось загрузить параметры лота'));
    }
  };

  const createLot = async () => {
    if (!form) return;
    const parsed = createLotSchema.safeParse(lotParamsPayload(form));
    if (!parsed.success) {
      setFormError(parsed.error.issues[0]?.message ?? 'Проверьте параметры лота');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      await api(`/events/${eventId}/loot/drops/${form.drop.id}/lot`, {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      setForm(null);
      setNotice('Лот создан и открыт для ставок');
      await load();
    } catch (err) {
      setFormError(errorMessage(err, 'Не удалось создать лот'));
    } finally {
      setBusy(false);
    }
  };

  const openManage = async (kind: ManageKind, drop: LootDropRow) => {
    if (!drop.lot) return;
    setManageError(null);
    setManageReason('');
    setManageValues({ minutes: '5', winnerId: '', price: '0' });
    setManage({ kind, lotId: drop.lot.id, itemName: drop.itemName, lotStatus: drop.lot.status });
    if (kind === 'award' && members.length === 0) {
      try {
        setMembers(await api<Array<{ id: string; nickname: string }>>('/members'));
      } catch {
        setManageError('Не удалось загрузить состав гильдии');
      }
    }
  };

  /** Ручное действие: валидация схемой, подтверждение на сервере, результат. */
  const applyManage = async () => {
    if (!manage) return;
    const lotId = manage.lotId;
    let payload: Record<string, unknown> | null = null;
    if (manage.kind === 'extend') {
      const parsed = extendLotSchema.safeParse({
        extendSec: Number(manageValues.minutes) * 60,
        comment: manageReason,
      });
      payload = parsed.success ? parsed.data : null;
      if (!parsed.success) setManageError(parsed.error.issues[0]?.message ?? 'Проверьте поля');
    } else if (manage.kind === 'cancel') {
      const parsed = cancelLotSchema.safeParse({ comment: manageReason });
      payload = parsed.success ? parsed.data : null;
      if (!parsed.success) setManageError(parsed.error.issues[0]?.message ?? 'Укажите причину');
    } else if (manage.kind === 'close') {
      const parsed = closeLotEarlySchema.safeParse({ comment: manageReason });
      payload = parsed.success ? parsed.data : null;
      if (!parsed.success) setManageError(parsed.error.issues[0]?.message ?? 'Укажите причину');
    } else {
      const parsed = assignWinnerSchema.safeParse({
        requestId: createRequestId(),
        winnerId: manageValues.winnerId,
        price: Number(manageValues.price),
        comment: manageReason,
      });
      payload = parsed.success ? parsed.data : null;
      if (!parsed.success)
        setManageError(parsed.error.issues[0]?.message ?? 'Выберите получателя и цену');
    }
    if (!payload) return;

    setBusy(true);
    setManageError(null);
    try {
      const result = await api<LotManageResult>(`/auctions/${lotId}/${manage.kind}`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setManage(null);
      setNotice(describeManage(manage.kind, result));
      // Списание и возврат меняют журнал ДКП — оповещаем виджеты балансов.
      if (manage.kind === 'close' || manage.kind === 'award') {
        window.dispatchEvent(new Event('dkp:changed'));
      }
      await load();
    } catch (err) {
      setManageError(errorMessage(err, 'Действие не выполнено — обновите список и повторите'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Дроп и лоты</SectionTitle>
      <Muted>
        Живая раздача запускает таймер торгов от первой ставки и закрывается без ставок по
        тайм-ауту; длинный лот отсчитывается от открытия. Лоты продолжают торги и после завершения
        ивента.
      </Muted>
      {notice && (
        <div className="mt-2">
          <Notice tone="success">{notice}</Notice>
        </div>
      )}
      {error && (
        <div className="mt-2">
          <ErrorText>{error}</ErrorText>
        </div>
      )}

      {canEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select
            value={selectedItemId}
            onChange={(e) => setSelectedItemId(e.target.value)}
            aria-label="Предмет из справочника"
          >
            <option value="">Выберите предмет…</option>
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
                {item.rarity ? ` (${item.rarity})` : ''}
              </option>
            ))}
          </Select>
          <Button disabled={busy || !selectedItemId} onClick={() => void recordDrop()}>
            Зафиксировать дроп
          </Button>
        </div>
      )}

      <div className="mt-3">
        {loading ? (
          <Muted>Загрузка…</Muted>
        ) : drops.length === 0 ? (
          <Muted>Дроп пока не зафиксирован.</Muted>
        ) : (
          <Table>
            <thead>
              <tr>
                <Table.Th>Предмет</Table.Th>
                <Table.Th>Кому нужна</Table.Th>
                <Table.Th>Лот</Table.Th>
                {(canEdit || canManage || canDecide) && <Table.Th>Действия</Table.Th>}
              </tr>
            </thead>
            <tbody>
              {drops.map((drop) => (
                <tr key={drop.id}>
                  <Table.Td className="font-medium">
                    {drop.itemName}
                    {drop.rarity && <Muted> · {drop.rarity}</Muted>}
                  </Table.Td>
                  <Table.Td>
                    <Badge tone={drop.targetRoles.includes('ALL') ? 'neutral' : 'accent'}>
                      {formatTargetRoles(drop.targetRoles)}
                    </Badge>
                  </Table.Td>
                  <Table.Td>
                    {drop.lot ? (
                      <span className="text-sm">
                        <Badge tone={drop.lot.status === 'OPEN' ? 'accent' : 'neutral'}>
                          {LOT_STATUS_LABELS[drop.lot.status]}
                        </Badge>{' '}
                        старт {drop.lot.startPrice} · шаг {drop.lot.step} ·{' '}
                        {drop.lot.timerKind === 'FIRST_BID'
                          ? `живая раздача ${formatDuration(drop.lot)}`
                          : `длинный лот ${formatDuration(drop.lot)}`}
                        {drop.lot.endsAt &&
                          ` · до ${new Date(drop.lot.endsAt).toLocaleString('ru-RU')}`}
                      </span>
                    ) : (
                      <Muted>Лот не создан</Muted>
                    )}
                  </Table.Td>
                  {(canEdit || canManage || canDecide) && (
                    <Table.Td>
                      <div className="flex flex-wrap gap-2">
                        {!drop.lot && canEdit && (
                          <Button disabled={busy} onClick={() => void openLotForm(drop)}>
                            Создать лот
                          </Button>
                        )}
                        {drop.lot?.status === 'OPEN' && canManage && (
                          <>
                            <Button disabled={busy} onClick={() => void openManage('extend', drop)}>
                              Продлить…
                            </Button>
                            <Button disabled={busy} onClick={() => void openManage('cancel', drop)}>
                              Отменить…
                            </Button>
                          </>
                        )}
                        {drop.lot?.status === 'OPEN' && canDecide && (
                          <>
                            <Button disabled={busy} onClick={() => void openManage('close', drop)}>
                              Завершить досрочно…
                            </Button>
                            <Button disabled={busy} onClick={() => void openManage('award', drop)}>
                              Назначить победителя…
                            </Button>
                          </>
                        )}
                        {drop.lot?.status === 'CLOSED' && canDecide && (
                          <Button disabled={busy} onClick={() => void openManage('award', drop)}>
                            Назначить победителя…
                          </Button>
                        )}
                        {drop.lot?.status === 'CANCELLED' && <Muted>Только просмотр</Muted>}
                      </div>
                    </Table.Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </div>

      {form && (
        <Modal
          title={`Новый лот: ${form.drop.itemName}`}
          onClose={() => !busy && setForm(null)}
          wide
        >
          <div className="flex flex-col gap-3">
            <LotParamsFields
              state={form}
              defaults={form.defaults}
              onChange={(next) => setForm({ ...form, ...next })}
            />
            {formError && <ErrorText>{formError}</ErrorText>}
            <div className="mt-2 flex justify-end gap-2">
              <Button disabled={busy} onClick={() => setForm(null)}>
                Отмена
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void createLot()}>
                {busy ? 'Создание…' : 'Создать лот'}
              </Button>
            </div>
          </div>
        </Modal>
      )}

      {manage && (
        <Modal
          title={`${MANAGE_TITLES[manage.kind]}: ${manage.itemName}`}
          onClose={() => !busy && setManage(null)}
        >
          <div className="flex flex-col gap-3">
            <Muted>{MANAGE_HINTS[manage.kind](manage.lotStatus)}</Muted>
            {manage.kind === 'extend' && (
              <Field label="Добавить времени, мин">
                <Input
                  type="number"
                  min={1}
                  step={1}
                  value={manageValues.minutes}
                  onChange={(e) => setManageValues({ ...manageValues, minutes: e.target.value })}
                />
              </Field>
            )}
            {manage.kind === 'award' && (
              <>
                <Field label="Получатель">
                  <Select
                    value={manageValues.winnerId}
                    onChange={(e) => setManageValues({ ...manageValues, winnerId: e.target.value })}
                  >
                    <option value="">Выберите игрока…</option>
                    {members.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.nickname}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Цена, ДКП (0 — бесплатно)">
                  <Input
                    type="number"
                    min={LOT_MANAGE_LIMITS.price.min}
                    max={LOT_MANAGE_LIMITS.price.max}
                    step={1}
                    value={manageValues.price}
                    onChange={(e) => setManageValues({ ...manageValues, price: e.target.value })}
                  />
                </Field>
              </>
            )}
            <Field label="Причина (попадёт в аудит)">
              <Input
                value={manageReason}
                onChange={(e) => setManageReason(e.target.value)}
                placeholder="Например: договорились передать щит танку"
              />
            </Field>
            {manageError && <ErrorText>{manageError}</ErrorText>}
            <div className="mt-2 flex justify-end gap-2">
              <Button disabled={busy} onClick={() => setManage(null)}>
                Отмена
              </Button>
              <Button variant="primary" disabled={busy} onClick={() => void applyManage()}>
                {busy ? 'Выполнение…' : MANAGE_BUTTONS[manage.kind]}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Card>
  );
}

const MANAGE_TITLES: Record<ManageKind, string> = {
  extend: 'Продлить лот',
  cancel: 'Отменить лот',
  close: 'Завершить досрочно',
  award: 'Назначить победителя',
};

const MANAGE_BUTTONS: Record<ManageKind, string> = {
  extend: 'Продлить',
  cancel: 'Отменить лот',
  close: 'Завершить торги',
  award: 'Назначить победителя',
};

const MANAGE_HINTS: Record<ManageKind, (lotStatus: LotStatus) => string> = {
  extend: () => 'Время прибавляется к текущему окончанию торгов.',
  cancel: () =>
    'Лот закрывается отменённым: ставки сгорают, замороженные очки возвращаются игрокам, списаний нет. Отменённый лот больше не меняется.',
  close: () =>
    'Побеждает автор ведущей ставки — списание как при обычном завершении. Если ставок нет, лот закроется без победителя.',
  award: (lotStatus) =>
    lotStatus === 'OPEN'
      ? 'Торги останавливаются: получатель — любой игрок, цена любая (может уйти в минус), без наценки.'
      : 'Прежнему победителю возвращается уплаченная сумма новой записью журнала, получение переходит новому.',
};

/** Короткий итог ручного действия для уведомления. */
function describeManage(kind: ManageKind, result: LotManageResult): string {
  if (result.repeated) return 'Назначение уже было применено — данные не менялись.';
  if (kind === 'extend') {
    return `Лот продлён до ${new Date(result.lot.endsAt ?? Date.now()).toLocaleString('ru-RU')}.`;
  }
  if (kind === 'cancel') return 'Лот отменён: заморозки сняты, списаний нет.';
  if (kind === 'close') {
    return result.winner
      ? `Лот завершён: победитель ${result.winner.memberName}, списано ${result.winner.finalPrice} ДКП.`
      : 'Лот завершён без ставок — предмет остаётся в гильдии.';
  }
  const refund = result.refund
    ? ` Прежнему победителю возвращено ${result.refund.amount} ДКП.`
    : '';
  return `Победитель: ${result.winner?.memberName ?? '—'} за ${result.winner?.finalPrice ?? 0} ДКП.${refund}`;
}

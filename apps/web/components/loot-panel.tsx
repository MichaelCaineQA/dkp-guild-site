'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createLotSchema,
  formatTargetRoles,
  LOT_DURATION_UNIT_LABELS,
  LOT_DURATION_UNITS,
  LOT_LIMITS,
  LOT_STATUS_LABELS,
  LOT_TIMER_KIND_LABELS,
  LOT_TIMER_KINDS,
  type ItemRow,
  type LootDropRow,
  type LotDefaults,
  type LotDurationUnit,
  type LotTimerKind,
} from '@dkp/shared';
import { api } from '../lib/api';
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

interface LotFormState {
  drop: LootDropRow;
  defaults: LotDefaults;
  startPrice: string;
  step: string;
  timerKind: LotTimerKind;
  durationValue: string;
  durationUnit: LotDurationUnit;
  antiSnipeSec: string;
  noBidTimeoutSec: string;
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
 * «Дроп и лоты» на странице проведения (issue #93, план 2.4/6): управляющий
 * ивента фиксирует выпавший предмет из справочника и создаёт открытый лот.
 * Начальные значения лота — из настроек и рекомендованной цены предмета,
 * их можно изменить под конкретный лот. Запись — только на запланированном
 * или идущем ивенте (2.6); на остальных статусах — просмотр.
 */
export function LootPanel({ eventId, canEdit }: { eventId: string; canEdit: boolean }) {
  const [drops, setDrops] = useState<LootDropRow[]>([]);
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<LotFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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
      setForm({
        drop,
        defaults,
        startPrice: String(defaults.startPrice),
        step: String(defaults.step),
        timerKind: 'FIRST_BID',
        durationValue: String(defaults.live.durationValue),
        durationUnit: defaults.live.durationUnit,
        antiSnipeSec: String(defaults.live.antiSnipeSec),
        noBidTimeoutSec: String(defaults.live.noBidTimeoutSec),
      });
    } catch (err) {
      setError(errorMessage(err, 'Не удалось загрузить параметры лота'));
    }
  };

  const switchKind = (form: LotFormState, timerKind: LotTimerKind): LotFormState => {
    if (timerKind === 'FIRST_BID') {
      return {
        ...form,
        timerKind,
        durationValue: String(form.defaults.live.durationValue),
        durationUnit: 'MINUTES',
        antiSnipeSec: String(form.defaults.live.antiSnipeSec),
        noBidTimeoutSec: String(form.defaults.live.noBidTimeoutSec),
      };
    }
    return {
      ...form,
      timerKind,
      durationValue: String(form.defaults.long.durationValue),
      durationUnit: 'DAYS',
      antiSnipeSec: String(form.defaults.long.antiSnipeSec),
    };
  };

  const createLot = async () => {
    if (!form) return;
    const payload = {
      startPrice: Number(form.startPrice),
      step: Number(form.step),
      timerKind: form.timerKind,
      durationValue: Number(form.durationValue),
      durationUnit: form.durationUnit,
      antiSnipeSec: Number(form.antiSnipeSec),
      noBidTimeoutSec:
        form.timerKind === 'FIRST_BID' ? Number(form.noBidTimeoutSec) : undefined,
    };
    const parsed = createLotSchema.safeParse(payload);
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

  return (
    <Card>
      <SectionTitle>Дроп и лоты</SectionTitle>
      <Muted>
        Живая раздача запускает таймер торгов от первой ставки и закрывается без ставок по
        тайм-ауту; длинный лот отсчитывается от открытия. Лоты продолжают торги и после
        завершения ивента.
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
                {canEdit && <Table.Th>Действия</Table.Th>}
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
                  {canEdit && (
                    <Table.Td>
                      {!drop.lot && (
                        <Button disabled={busy} onClick={() => void openLotForm(drop)}>
                          Создать лот
                        </Button>
                      )}
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
            <Field label="Тип таймера">
              <Select
                value={form.timerKind}
                onChange={(e) => setForm(switchKind(form, e.target.value as LotTimerKind))}
              >
                {LOT_TIMER_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {LOT_TIMER_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Стартовая цена">
              <Input
                type="number"
                min={LOT_LIMITS.startPrice.min}
                max={LOT_LIMITS.startPrice.max}
                step={1}
                value={form.startPrice}
                onChange={(e) => setForm({ ...form, startPrice: e.target.value })}
              />
            </Field>
            <Field label="Минимальный шаг ставки">
              <Input
                type="number"
                min={LOT_LIMITS.step.min}
                max={LOT_LIMITS.step.max}
                step={1}
                value={form.step}
                onChange={(e) => setForm({ ...form, step: e.target.value })}
              />
            </Field>
            <Field label="Длительность">
              <Input
                type="number"
                min={0}
                step={form.durationUnit === 'MINUTES' ? 0.5 : 1}
                value={form.durationValue}
                onChange={(e) => setForm({ ...form, durationValue: e.target.value })}
              />
              <Select
                value={form.durationUnit}
                onChange={(e) =>
                  setForm({ ...form, durationUnit: e.target.value as LotDurationUnit })
                }
                aria-label="Единица длительности"
              >
                {LOT_DURATION_UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {LOT_DURATION_UNIT_LABELS[unit]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Анти-снайп, сек (окно и продление)">
              <Input
                type="number"
                min={LOT_LIMITS.antiSnipeSec.min}
                max={LOT_LIMITS.antiSnipeSec.max}
                step={1}
                value={form.antiSnipeSec}
                onChange={(e) => setForm({ ...form, antiSnipeSec: e.target.value })}
              />
            </Field>
            {form.timerKind === 'FIRST_BID' && (
              <Field label="Тайм-аут без ставок, сек">
                <Input
                  type="number"
                  min={LOT_LIMITS.noBidTimeoutSec.min}
                  max={LOT_LIMITS.noBidTimeoutSec.max}
                  step={1}
                  value={form.noBidTimeoutSec}
                  onChange={(e) => setForm({ ...form, noBidTimeoutSec: e.target.value })}
                />
              </Field>
            )}
            <Muted>
              Наценка «чужим» классам по настройкам гильдии: {form.defaults.markupPct}% —
              зафиксируется на лоте при создании.
            </Muted>
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
    </Card>
  );
}

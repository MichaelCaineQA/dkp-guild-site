'use client';

import { useEffect, useState } from 'react';
import {
  createStandaloneLotSchema,
  ITEM_RARITIES,
  ITEM_SLOTS,
  ITEM_TARGET_ROLES,
  ITEM_TARGET_ROLE_LABELS,
  type ItemTargetRole,
  type ItemRow,
  type LotDefaults,
} from '@dkp/shared';
import { api } from '../lib/api';
import { Button, ErrorText, Field, Input, Modal, Muted, Select } from './ui';
import {
  LotParamsFields,
  lotParamsFromDefaults,
  lotParamsPayload,
  type LotParamsState,
} from './lot-params-fields';

function errorMessage(error: unknown, fallback: string): string {
  const body = (error as { body?: { message?: string | string[] } }).body;
  const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
  return message ?? fallback;
}

/**
 * Создание лота вне ивента — «хранилище гильдии» (#137, план 2.4): предмет
 * выбирается из справочника, лот открывается сразу, без дропа на ивенте.
 * По умолчанию длинный лот — раздача не на ивенте. Доступно Главе/Админу.
 */
export function CreateLotDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [items, setItems] = useState<ItemRow[]>([]);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemId, setItemId] = useState('');
  const [defaults, setDefaults] = useState<LotDefaults | null>(null);
  const [params, setParams] = useState<LotParamsState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creatingItem, setCreatingItem] = useState(false);
  const [name, setName] = useState('');
  const [rarity, setRarity] = useState('');
  const [slot, setSlot] = useState('');
  const [price, setPrice] = useState('');
  const [roles, setRoles] = useState<ItemTargetRole[]>(['ALL']);

  useEffect(() => {
    api<ItemRow[]>('/items')
      .then((loaded) =>
        setItems((current) => [
          ...loaded,
          ...current.filter((item) => !loaded.some((entry) => entry.id === item.id)),
        ]),
      )
      .catch(() => setItemsError('Не удалось загрузить справочник предметов'));
  }, []);

  const pickItem = async (id: string) => {
    setItemId(id);
    setDefaults(null);
    setParams(null);
    setError(null);
    if (!id) return;
    try {
      const loaded = await api<LotDefaults>(`/auctions/lot-defaults/${id}`);
      setDefaults(loaded);
      setParams(lotParamsFromDefaults('OPENING', loaded));
    } catch (err) {
      setError(errorMessage(err, 'Не удалось загрузить параметры лота'));
    }
  };

  const createItem = async () => {
    setBusy(true);
    setError(null);
    try {
      const item = await api<ItemRow>('/items', {
        method: 'POST',
        body: JSON.stringify({
          name,
          rarity: rarity || null,
          slot: slot || null,
          targetRoles: roles,
          defaultStartPrice: price.trim() === '' ? null : Number(price),
        }),
      });
      setItems((current) => [...current.filter((entry) => entry.id !== item.id), item]);
      setItemsError(null);
      setCreatingItem(false);
      await pickItem(item.id);
    } catch (err) {
      setError(errorMessage(err, 'Не удалось создать предмет'));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!params || !itemId) return;
    const parsed = createStandaloneLotSchema.safeParse({ ...lotParamsPayload(params), itemId });
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message ?? 'Проверьте параметры лота');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api('/auctions', { method: 'POST', body: JSON.stringify(parsed.data) });
      onCreated();
      onClose();
    } catch (err) {
      setError(errorMessage(err, 'Не удалось создать лот'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Новый лот из хранилища гильдии" onClose={() => !busy && onClose()} wide>
      <div className="flex flex-col gap-3">
        <Muted>
          Лот без ивента: предмет из хранилища гильдии. Торги идут как обычно — ставки, анти-снайп,
          автосписание; продлить или отменить может Глава/Админ.
        </Muted>
        <Field label="Предмет из справочника">
          <Select
            value={itemId}
            onChange={(e) => void pickItem(e.target.value)}
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
        </Field>
        {!creatingItem ? (
          <Button
            disabled={busy}
            onClick={() => {
              setError(null);
              setCreatingItem(true);
            }}
          >
            Добавить новый предмет
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <Muted>Новый предмет будет сохранён в справочнике.</Muted>
            <Field label="Название предмета">
              <Input
                aria-label="Название предмета"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
              />
            </Field>
            <Field label="Редкость">
              <Select
                aria-label="Редкость"
                value={rarity}
                onChange={(e) => setRarity(e.target.value)}
              >
                <option value="">не указана</option>
                {ITEM_RARITIES.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Слот">
              <Select aria-label="Слот" value={slot} onChange={(e) => setSlot(e.target.value)}>
                <option value="">не указан</option>
                {ITEM_SLOTS.map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Рекомендованная стартовая цена">
              <Input
                aria-label="Рекомендованная стартовая цена"
                type="number"
                min={0}
                step={1}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </Field>
            <Field label="Кому нужна">
              <div className="flex flex-wrap gap-3">
                {ITEM_TARGET_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={roles.includes(role)}
                      onChange={() =>
                        setRoles((current) =>
                          role === 'ALL'
                            ? current.includes('ALL')
                              ? []
                              : ['ALL']
                            : current.includes(role)
                              ? current.filter((r) => r !== role)
                              : [...current.filter((r) => r !== 'ALL'), role],
                        )
                      }
                    />
                    {ITEM_TARGET_ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
            </Field>
            <div className="flex justify-end gap-2">
              <Button
                disabled={busy}
                onClick={() => {
                  setCreatingItem(false);
                  setError(null);
                }}
              >
                Отмена
              </Button>
              <Button
                disabled={busy || !name.trim() || roles.length === 0}
                onClick={() => void createItem()}
              >
                {busy ? 'Сохранение…' : 'Сохранить предмет'}
              </Button>
            </div>
          </div>
        )}
        {itemsError && <ErrorText>{itemsError}</ErrorText>}
        {defaults && params && (
          <LotParamsFields state={params} defaults={defaults} onChange={setParams} />
        )}
        {error && <ErrorText>{error}</ErrorText>}
        <div className="mt-2 flex justify-end gap-2">
          <Button disabled={busy} onClick={onClose}>
            Отмена
          </Button>
          <Button
            variant="primary"
            disabled={busy || creatingItem || !itemId || !params}
            onClick={() => void submit()}
          >
            {busy ? 'Создание…' : 'Создать лот'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

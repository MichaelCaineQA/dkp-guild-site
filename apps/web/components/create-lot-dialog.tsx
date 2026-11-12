'use client';

import { useEffect, useState } from 'react';
import { createStandaloneLotSchema, type ItemRow, type LotDefaults } from '@dkp/shared';
import { api } from '../lib/api';
import { Button, ErrorText, Field, Modal, Muted, Select } from './ui';
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

  useEffect(() => {
    api<ItemRow[]>('/items')
      .then(setItems)
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
          Лот без ивента: предмет из хранилища гильдии. Торги идут как обычно — ставки,
          анти-снайп, автосписание; продлить или отменить может Глава/Админ.
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
            disabled={busy || !itemId || !params}
            onClick={() => void submit()}
          >
            {busy ? 'Создание…' : 'Создать лот'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

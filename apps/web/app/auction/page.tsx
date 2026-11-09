'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ITEM_RARITIES,
  ITEM_SLOTS,
  ITEM_TARGET_ROLE_LABELS,
  ITEM_TARGET_ROLES,
  can,
  formatTargetRoles,
  type ItemRow,
  type ItemTargetRole,
} from '@dkp/shared';
import { useSession } from '../../components/session-context';
import { api } from '../../lib/api';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Modal,
  Muted,
  Page,
  PageHeader,
  SectionTitle,
  Select,
  Table,
} from '../../components/ui';

type Tab = 'lots' | 'items';

interface ItemFormState {
  id: string | null;
  name: string;
  rarity: string;
  slot: string;
  price: string;
  roles: ItemTargetRole[];
}

const EMPTY_FORM: ItemFormState = {
  id: null,
  name: '',
  rarity: '',
  slot: '',
  price: '',
  roles: ['ALL'],
};

function errorMessage(error: unknown, fallback: string): string {
  const body = (error as { body?: { message?: string | string[] } }).body;
  const message = Array.isArray(body?.message) ? body.message[0] : body?.message;
  return message ?? fallback;
}

/**
 * «Аукцион» (issue #92, план 2.4): справочник предметов читают все члены
 * гильдии, ведут Офицер/Глава/Админ (право items.manage). Экран лотов —
 * отдельная задача этапа 2 (#98).
 */
export default function AuctionPage() {
  const { user, loading: sessionLoading } = useSession();
  const [tab, setTab] = useState<Tab>('lots');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [form, setForm] = useState<ItemFormState | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const canManage = user ? can(user, 'items.manage') : false;

  const load = useCallback(async () => {
    try {
      setItems(await api<ItemRow[]>('/items'));
      setError(null);
    } catch {
      setError('Не удалось загрузить справочник предметов');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!sessionLoading && (user?.memberId || user?.isAdmin)) {
      void load();
    }
  }, [sessionLoading, user, load]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((item) => item.name.toLowerCase().includes(needle));
  }, [items, search]);

  if (sessionLoading) {
    return <Page>Загрузка…</Page>;
  }

  if (!user || (!user.memberId && !user.isAdmin)) {
    return (
      <Page>
        <PageHeader title="Аукцион" subtitle="Раздел доступен членам гильдии после входа." />
      </Page>
    );
  }

  const openCreate = () => {
    setFormError(null);
    setForm({ ...EMPTY_FORM });
  };

  const openEdit = (item: ItemRow) => {
    setFormError(null);
    setForm({
      id: item.id,
      name: item.name,
      rarity: item.rarity ?? '',
      slot: item.slot ?? '',
      price: item.defaultStartPrice === null ? '' : String(item.defaultStartPrice),
      roles: item.targetRoles,
    });
  };

  const toggleRole = (role: ItemTargetRole) => {
    if (!form) return;
    let roles: ItemTargetRole[];
    if (role === 'ALL') {
      roles = form.roles.includes('ALL') ? [] : ['ALL'];
    } else {
      const withoutAll = form.roles.filter((r) => r !== 'ALL');
      roles = withoutAll.includes(role)
        ? withoutAll.filter((r) => r !== role)
        : [...withoutAll, role];
    }
    setForm({ ...form, roles });
  };

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setFormError(null);
    const payload = {
      name: form.name,
      rarity: form.rarity || null,
      slot: form.slot || null,
      targetRoles: form.roles,
      defaultStartPrice: form.price.trim() === '' ? null : Number(form.price),
    };
    try {
      if (form.id) {
        await api(`/items/${form.id}`, { method: 'PUT', body: JSON.stringify(payload) });
      } else {
        await api('/items', { method: 'POST', body: JSON.stringify(payload) });
      }
      setForm(null);
      await load();
    } catch (err) {
      setFormError(errorMessage(err, 'Не удалось сохранить предмет'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: ItemRow) => {
    setDeletingId(item.id);
    setError(null);
    try {
      await api(`/items/${item.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      setError(errorMessage(err, 'Не удалось удалить предмет'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <Page width="wide">
      <PageHeader
        title="Аукцион"
        subtitle="Открытый аукцион лута: справочник предметов и торги (план 2.4/6)."
      />

      <div className="mb-4 flex gap-2" role="tablist" aria-label="Разделы аукциона">
        {(
          [
            ['lots', 'Лоты'],
            ['items', 'Справочник предметов'],
          ] as Array<[Tab, string]>
        ).map(([key, label]) => (
          <Button key={key} onClick={() => setTab(key)} aria-pressed={tab === key}>
            {label}
          </Button>
        ))}
      </div>

      {tab === 'lots' && (
        <Card>
          <SectionTitle>Лоты</SectionTitle>
          <Muted>Торги появятся в следующем обновлении — сейчас доступен справочник предметов.</Muted>
        </Card>
      )}

      {tab === 'items' && (
        <Card>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <SectionTitle>Справочник предметов</SectionTitle>
            <div className="flex flex-wrap items-center gap-3">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Поиск по названию"
                aria-label="Поиск по названию"
              />
              {canManage && <Button onClick={openCreate}>Добавить предмет</Button>}
            </div>
          </div>
          {error && <ErrorText>{error}</ErrorText>}
          {loading ? (
            <Muted>Загрузка…</Muted>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Table.Th>Название</Table.Th>
                  <Table.Th>Редкость</Table.Th>
                  <Table.Th>Слот</Table.Th>
                  <Table.Th>Кому нужна</Table.Th>
                  <Table.Th>Стартовая цена</Table.Th>
                  <Table.Th>Лотов</Table.Th>
                  {canManage && <Table.Th>Действия</Table.Th>}
                </tr>
              </thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id}>
                    <Table.Td className="font-medium">{item.name}</Table.Td>
                    <Table.Td>{item.rarity ?? <Muted>—</Muted>}</Table.Td>
                    <Table.Td>{item.slot ?? <Muted>—</Muted>}</Table.Td>
                    <Table.Td>
                      <Badge tone={item.targetRoles.includes('ALL') ? 'neutral' : 'accent'}>
                        {formatTargetRoles(item.targetRoles)}
                      </Badge>
                    </Table.Td>
                    <Table.Td className="tabular-nums">
                      {item.defaultStartPrice ?? <Muted>0</Muted>}
                    </Table.Td>
                    <Table.Td className="tabular-nums">{item.lotsCount}</Table.Td>
                    {canManage && (
                      <Table.Td className="whitespace-nowrap">
                        <Button onClick={() => openEdit(item)}>Изменить</Button>{' '}
                        <Button
                          disabled={item.lotsCount > 0 || deletingId === item.id}
                          title={
                            item.lotsCount > 0
                              ? 'Предмет используется в лотах — удаление запрещено'
                              : undefined
                          }
                          onClick={() => void remove(item)}
                        >
                          {deletingId === item.id ? 'Удаление…' : 'Удалить'}
                        </Button>
                      </Table.Td>
                    )}
                  </tr>
                ))}
                {visible.length === 0 && (
                  <tr>
                    <Table.Td colSpan={canManage ? 7 : 6}>
                      <Muted>
                        {search ? 'Ничего не найдено' : 'Справочник пока пуст'}
                      </Muted>
                    </Table.Td>
                  </tr>
                )}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      {form && (
        <Modal
          title={form.id ? 'Изменить предмет' : 'Новый предмет'}
          onClose={() => !saving && setForm(null)}
          wide
        >
          <div className="flex flex-col gap-3">
            <Field label="Название">
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={80}
                autoFocus
              />
            </Field>
            <Field label="Редкость">
              <Select
                value={form.rarity}
                onChange={(e) => setForm({ ...form, rarity: e.target.value })}
              >
                <option value="">не указана</option>
                {ITEM_RARITIES.map((rarity) => (
                  <option key={rarity} value={rarity}>
                    {rarity}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Слот">
              <Select value={form.slot} onChange={(e) => setForm({ ...form, slot: e.target.value })}>
                <option value="">не указан</option>
                {ITEM_SLOTS.map((slot) => (
                  <option key={slot} value={slot}>
                    {slot}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Рекомендованная стартовая цена">
              <Input
                type="number"
                min={0}
                step={1}
                value={form.price}
                placeholder="0"
                onChange={(e) => setForm({ ...form, price: e.target.value })}
              />
            </Field>
            <Field label="Кому нужна">
              <div className="flex flex-wrap gap-3">
                {ITEM_TARGET_ROLES.map((role) => (
                  <label key={role} className="flex items-center gap-1.5 text-sm">
                    <input
                      type="checkbox"
                      checked={form.roles.includes(role)}
                      onChange={() => toggleRole(role)}
                    />
                    {ITEM_TARGET_ROLE_LABELS[role]}
                  </label>
                ))}
              </div>
            </Field>
            {form.roles.length === 0 && <ErrorText>Выберите, кому нужен предмет</ErrorText>}
            {formError && <ErrorText>{formError}</ErrorText>}
            <div className="mt-2 flex justify-end gap-2">
              <Button disabled={saving} onClick={() => setForm(null)}>
                Отмена
              </Button>
              <Button
                disabled={saving || form.roles.length === 0 || form.name.trim() === ''}
                onClick={() => void save()}
              >
                {saving ? 'Сохранение…' : 'Сохранить'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </Page>
  );
}

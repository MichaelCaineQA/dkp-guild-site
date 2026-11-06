'use client';

import { useEffect, useState } from 'react';
import { can, type AuditRow } from '@dkp/shared';
import { useSession } from '../../components/session-context';
import { api } from '../../lib/api';
import {
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Muted,
  Page,
  PageHeader,
  Select,
  Table,
} from '../../components/ui';

const ACTION_LABELS: Record<string, string> = {
  LOGIN_DISCORD: 'Вход через Discord',
  LOGIN_ADMIN: 'Вход администратора',
  LOGIN_TEST: 'Тестовый вход',
  LINK_REQUEST_CREATE: 'Заявка на привязку',
  LINK_REQUEST_APPROVE: 'Привязка подтверждена',
  LINK_REQUEST_REJECT: 'Привязка отклонена',
  MEMBER_CREATE: 'Добавление участника',
  MEMBER_UPDATE: 'Изменение участника',
  ROLE_CHANGE: 'Смена ранга',
  EVENT_CREATE: 'Создание ивента',
  EVENT_UPDATE: 'Изменение ивента',
  EVENT_DELETE: 'Удаление ивента',
  EVENT_SERIES_CREATE: 'Создание серии',
  EVENT_SERIES_DELETE: 'Удаление серии',
  EVENT_STATUS_CHANGE: 'Смена статуса ивента',
  SETTINGS_UPDATE: 'Изменение настроек',
  EVENT_TYPE_CREATE: 'Создание типа ивента',
  EVENT_TYPE_UPDATE: 'Изменение типа ивента',
  EVENT_TYPE_DELETE: 'Удаление типа ивента',
  MANUAL_ATTENDANCE: 'Ручная отметка посещения',
  MANUAL_CHECKIN: 'Ручной чек-ин',
  MANUAL_DKP: 'Ручное изменение ДКП',
  CHECKIN_END_EARLY: 'Досрочный финальный код',
  ABSENCE_CREATE: 'Создание отсутствия',
  ABSENCE_CANCEL: 'Отмена отсутствия',
  ABSENCE_SEEN: 'Отметка «Увидел»',
  ABSENCE_AUTO_MARK: 'Автоматическая отметка отсутствия',
};
const ENTITY_LABELS: Record<string, string> = {
  User: 'Аккаунт',
  Member: 'Участник',
  Event: 'Ивент',
  EventSeries: 'Серия',
  EventType: 'Тип ивента',
  Setting: 'Настройка',
  Guild: 'Гильдия',
  Absence: 'Отсутствие',
  MemberLinkRequest: 'Привязка',
  Attendance: 'Посещение',
  DkpEntry: 'Операция ДКП',
};
const LIMIT = 50;

export default function AuditPage() {
  const { user, loading: sessionLoading } = useSession();
  const allowed =
    !!user &&
    can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, 'audit.view');
  const [entries, setEntries] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [members, setMembers] = useState<Array<{ id: string; nickname: string }>>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    Promise.all([
      api<Array<{ id: string; nickname: string }>>('/members'),
      api<string[]>('/audit/actions'),
    ])
      .then(([roster, kinds]) => {
        if (active) {
          setMembers(roster);
          setActions(kinds);
        }
      })
      .catch(() => {
        if (active) setError('Не удалось загрузить справочники фильтров');
      });
    return () => {
      active = false;
    };
  }, [allowed]);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    if (from && to && new Date(from) > new Date(to)) {
      setError('Начало периода должно быть не позже конца');
      setLoading(false);
      return;
    }
    setLoading(true);
    const params = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
    if (actor) params.set('actorMemberId', actor);
    if (action) params.set('action', action);
    if (from) params.set('from', new Date(from).toISOString());
    if (to) params.set('to', new Date(to).toISOString());
    api<{ entries: AuditRow[]; total: number }>(`/audit?${params}`)
      .then((data) => {
        if (active) {
          setEntries(data.entries);
          setTotal(data.total);
          setError('');
        }
      })
      .catch(() => {
        if (active) {
          setEntries([]);
          setError('Не удалось загрузить аудит-лог');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [allowed, actor, action, from, to, offset]);

  if (sessionLoading) return <Page>Загрузка…</Page>;
  if (!allowed)
    return (
      <Page>
        <PageHeader
          title="Аудит-лог"
          subtitle="Журнал доступен офицерам, главе и администратору."
        />
      </Page>
    );
  return (
    <Page width="wide">
      <PageHeader
        title="Аудит-лог"
        subtitle="Действия пользователей и комментарии. Время показано в вашей таймзоне."
      />
      <Card className="mb-4">
        <div className="flex flex-wrap gap-3">
          <Field label="Кто">
            <Select
              value={actor}
              onChange={(e) => {
                setActor(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Все участники</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.nickname}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Действие">
            <Select
              value={action}
              onChange={(e) => {
                setAction(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Все действия</option>
              {actions.map((kind) => (
                <option key={kind} value={kind}>
                  {ACTION_LABELS[kind] ?? 'Другое действие'}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="С">
            <Input
              type="datetime-local"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setOffset(0);
              }}
            />
          </Field>
          <Field label="По">
            <Input
              type="datetime-local"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setOffset(0);
              }}
            />
          </Field>
        </div>
      </Card>
      {error && (
        <div role="alert">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {loading ? (
        <p role="status">Загрузка журнала…</p>
      ) : (
        !error && (
          <Card>
            <Muted>Найдено записей: {total}</Muted>
            {entries.length === 0 ? (
              <p>Записей по выбранным фильтрам нет</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    {['Когда', 'Кто', 'Действие', 'Объект', 'Комментарий'].map((label) => (
                      <Table.Th key={label}>{label}</Table.Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id}>
                      <Table.Td>{new Date(entry.createdAt).toLocaleString('ru-RU')}</Table.Td>
                      <Table.Td>{entry.actorName ?? 'Без участника'}</Table.Td>
                      <Table.Td>{ACTION_LABELS[entry.action] ?? 'Другое действие'}</Table.Td>
                      <Table.Td>
                        <span className="break-all">
                          {ENTITY_LABELS[entry.entityType] ?? 'Объект'}: {entry.entityId}
                        </span>
                      </Table.Td>
                      <Table.Td className="min-w-48 break-words">
                        {entry.comment ?? 'Без комментария'}
                      </Table.Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <div className="mt-4 flex items-center gap-3">
              <Button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - LIMIT))}
              >
                Назад
              </Button>
              <span>Страница {Math.floor(offset / LIMIT) + 1}</span>
              <Button disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}>
                Далее
              </Button>
            </div>
          </Card>
        )
      )}
    </Page>
  );
}

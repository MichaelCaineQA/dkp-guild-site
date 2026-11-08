'use client';
import { AUDIT_ENTITY_LABELS } from '@dkp/shared';

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
  Page,
  PageHeader,
  Select,
  AuditFeed,
} from '../../components/ui';

export default function AuditPage() {
  const { user, loading: sessionLoading } = useSession();
  const allowed =
    !!user &&
    can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, 'members.view_roster');
  const [entries, setEntries] = useState<AuditRow[]>([]);
  const [total, setTotal] = useState(0);
  const [members, setMembers] = useState<Array<{ id: string; nickname: string }>>([]);
  const [limit, setLimit] = useState(50);
  const [actor, setActor] = useState('');
  const [entity, setEntity] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [filterError, setFilterError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    api<Array<{ id: string; nickname: string }>>('/members')
      .then((roster) => {
        if (active) setMembers(roster);
      })
      .catch(() => {
        if (active) setFilterError('Не удалось загрузить список авторов');
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
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    if (actor === '__system__') params.set('system', 'true');
    else if (actor) params.set('actorMemberId', actor);
    if (entity) params.set('entityType', entity);
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
  }, [allowed, actor, entity, from, to, offset, limit]);

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
              <option value="">Все авторы</option>
              <option value="__system__">Система</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.nickname}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Сущность">
            <Select
              value={entity}
              onChange={(e) => {
                setEntity(e.target.value);
                setOffset(0);
              }}
            >
              <option value="">Все сущности</option>
              {Object.entries(AUDIT_ENTITY_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Записей на странице">
            <Select
              value={limit}
              onChange={(e) => {
                setLimit(Number(e.target.value));
                setOffset(0);
              }}
            >
              {[10, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
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
      {filterError && <ErrorText>{filterError}</ErrorText>}
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
            {entries.length === 0 ? (
              <p>Записей по выбранным фильтрам нет</p>
            ) : (
              <AuditFeed entries={entries} />
            )}
            <div className="mt-4 flex items-center gap-3">
              <Button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - limit))}
              >
                Назад
              </Button>
              <span>Страница {Math.floor(offset / limit) + 1}</span>
              <Button disabled={offset + limit >= total} onClick={() => setOffset(offset + limit)}>
                Далее
              </Button>
            </div>
          </Card>
        )
      )}
    </Page>
  );
}

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { can, type SettingKey } from '@dkp/shared';
import { useSession } from '../../components/session-context';
import { SettingsEditor } from '../../components/settings-editor';
import { GuildSettings } from '../../components/guild-settings';
import { api } from '../../lib/api';
import {
  Button,
  Card,
  ErrorText,
  Input,
  Muted,
  Notice,
  Page,
  PageHeader,
  SectionTitle,
  Table,
} from '../../components/ui';

interface EventTypeRow {
  id: string;
  name: string;
}

interface GameTimeSettings {
  gameTimeAnchor: string;
  gameTimeDayMinutes: number;
  gameTimeNightMinutes: number;
}

type SettingsMap = Record<SettingKey, number>;

/**
 * Справочники и настройки (issue #7): типы ивентов — офицерам+,
 * значения настроек — Главе/Админу. Игровой цикл — отдельно (хранится на Guild).
 */
export default function SettingsPage() {
  const { user, loading: sessionLoading } = useSession();
  const [settings, setSettings] = useState<SettingsMap | null>(null);
  const [gameTime, setGameTime] = useState<GameTimeSettings | null>(null);
  const [eventTypes, setEventTypes] = useState<EventTypeRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const canManageTypes = useMemo(
    () =>
      user &&
      can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, 'items.manage'),
    [user],
  );
  const canManageSettings = useMemo(
    () =>
      user &&
      can({ rank: user.rank, isAdmin: user.isAdmin, memberId: user.memberId }, 'settings.manage'),
    [user],
  );

  const load = useCallback(async () => {
    try {
      const [settingsData, gameTimeData, typesData] = await Promise.all([
        api<SettingsMap>('/settings'),
        api<GameTimeSettings>('/settings/game-time'),
        api<EventTypeRow[]>('/event-types'),
      ]);
      setSettings(settingsData);
      setGameTime(gameTimeData);
      setEventTypes(typesData);
      setError(null);
    } catch {
      setError('Не удалось загрузить настройки');
    }
  }, []);

  useEffect(() => {
    // Грузим данные только когда экран реально показан (офицер+):
    // рядовому рано возвращаемся, запросы ему не нужны.
    if (!sessionLoading && canManageSettings) {
      void load();
    }
  }, [sessionLoading, canManageTypes, canManageSettings, load]);

  if (sessionLoading) {
    return <Page>Загрузка…</Page>;
  }

  if (!user) {
    return (
      <Page>
        <PageHeader
          title="Справочники и настройки"
          subtitle="Раздел доступен членам гильдии после входа."
        />
      </Page>
    );
  }

  if (!canManageSettings) {
    return (
      <Page>
        <PageHeader title="Справочники и настройки" subtitle="Раздел доступен Главе и Админу." />
      </Page>
    );
  }

  return (
    <Page width="wide">
      <PageHeader title="Справочники и настройки" />
      {error && <ErrorText>{error}</ErrorText>}
      <GuildSettings />

      {settings && gameTime && (
        <SettingsEditor
          settings={settings}
          gameTime={gameTime}
          onSettingsSaved={setSettings}
          onGameTimeSaved={setGameTime}
        />
      )}

      <div className="mt-4" />

      <EventTypesSection types={eventTypes} canEdit={!!canManageTypes} onChanged={load} />
    </Page>
  );
}

/** Справочник типов ивентов: добавление/переименование/удаление. */
function EventTypesSection({
  types,
  canEdit,
  onChanged,
}: {
  types: EventTypeRow[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [name, setName] = useState('');
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const act = async (action: () => Promise<unknown>, okMessage: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      setMessage(okMessage);
      onChanged();
      return true;
    } catch (err) {
      const status = (err as { status?: number }).status;
      setMessage(status === 409 ? 'Конфликт: такое название уже есть' : 'Не получилось');
      return false;
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Типы ивентов</SectionTitle>
      {!canEdit && <Muted>Изменение — офицерам и выше.</Muted>}
      <Table>
        <thead>
          <tr>
            <Table.Th>Название</Table.Th>
            {canEdit && <Table.Th>Действия</Table.Th>}
          </tr>
        </thead>
        <tbody>
          {types.map((type) => (
            <tr key={type.id}>
              <Table.Td>
                {canEdit ? (
                  <Input
                    value={renames[type.id] ?? type.name}
                    onChange={(e) => setRenames((prev) => ({ ...prev, [type.id]: e.target.value }))}
                  />
                ) : (
                  type.name
                )}
              </Table.Td>
              {canEdit && (
                <Table.Td>
                  <span className="flex gap-2">
                    <Button
                      disabled={busy || !renames[type.id] || renames[type.id] === type.name}
                      onClick={() =>
                        act(
                          () =>
                            api(`/event-types/${type.id}`, {
                              method: 'PUT',
                              body: JSON.stringify({ name: renames[type.id] }),
                            }),
                          'Переименовано',
                        )
                      }
                    >
                      Переименовать
                    </Button>
                    <Button
                      variant="danger"
                      disabled={busy}
                      onClick={() =>
                        act(() => api(`/event-types/${type.id}`, { method: 'DELETE' }), 'Удалено')
                      }
                    >
                      Удалить
                    </Button>
                  </span>
                </Table.Td>
              )}
            </tr>
          ))}
          {types.length === 0 && (
            <tr>
              <Table.Td colSpan={canEdit ? 2 : 1}>
                <Muted>Справочник пуст</Muted>
              </Table.Td>
            </tr>
          )}
        </tbody>
      </Table>
      {canEdit && (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act(
              () => api('/event-types', { method: 'POST', body: JSON.stringify({ name }) }),
              'Добавлено',
            ).then((ok) => {
              if (ok) setName('');
            });
          }}
        >
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Новый тип ивента"
            minLength={2}
            maxLength={40}
          />
          <Button variant="primary" type="submit" disabled={busy || name.trim().length < 2}>
            Добавить
          </Button>
          {message && <Notice>{message}</Notice>}
        </form>
      )}
    </Card>
  );
}

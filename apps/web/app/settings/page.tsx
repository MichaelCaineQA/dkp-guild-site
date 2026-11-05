'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { SETTINGS_REGISTRY, can, type SettingKey } from '@dkp/shared';
import { useSession } from '../../components/session-context';
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
    if (!sessionLoading && (canManageTypes || canManageSettings)) {
      void load();
    }
  }, [sessionLoading, canManageTypes, canManageSettings, load]);

  if (sessionLoading) {
    return <Page>Загрузка…</Page>;
  }

  if (!user) {
    return (
      <Page>
        <PageHeader title="Справочники и настройки" subtitle="Раздел доступен членам гильдии после входа." />
      </Page>
    );
  }

  if (!canManageTypes && !canManageSettings) {
    return (
      <Page>
        <PageHeader title="Справочники и настройки" subtitle="Раздел доступен офицерам и выше." />
      </Page>
    );
  }

  return (
    <Page width="wide">
      <PageHeader title="Справочники и настройки" />
      {error && <ErrorText>{error}</ErrorText>}

      {settings && gameTime && (
        <SettingsSection
          settings={settings}
          gameTime={gameTime}
          canEdit={!!canManageSettings}
          onSaved={load}
        />
      )}

      <div className="mt-4" />

      <EventTypesSection types={eventTypes} canEdit={!!canManageTypes} onChanged={load} />
    </Page>
  );
}

/** Значения настроек по группам реестра + игровой цикл. */
function SettingsSection({
  settings,
  gameTime,
  canEdit,
  onSaved,
}: {
  settings: SettingsMap;
  gameTime: GameTimeSettings;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Partial<SettingsMap>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const groups: Array<{ title: string; keys: SettingKey[] }> = [
    {
      title: 'Чек-ин кодами (план 2.2)',
      keys: [
        'checkin.generateBeforeStartSec',
        'checkin.windowSec',
        'checkin.attempts',
        'checkin.startSharePct',
        'checkin.endSharePct',
      ],
    },
    { title: 'Отсутствия (план 2.3)', keys: ['absence.deadlineBeforeStartSec'] },
    {
      title: 'Аукцион (план 6)',
      keys: [
        'auction.step',
        'auction.liveDurationSec',
        'auction.longDurationDays',
        'auction.antiSnipeLiveSec',
        'auction.antiSnipeLongSec',
        'auction.foreignClassMarkupPct',
        'auction.noBidTimeoutSec',
      ],
    },
  ];

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify(draft) });
      setDraft({});
      setMessage('Сохранено');
      onSaved();
    } catch (err) {
      const status = (err as { status?: number }).status;
      setMessage(status === 403 ? 'Недостаточно прав' : 'Не получилось сохранить');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <SectionTitle>Настройки системы</SectionTitle>
      {!canEdit && <Muted>Изменение — только Глава и Админ.</Muted>}
      {groups.map((group) => (
        <div key={group.title} className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-secondary">{group.title}</h3>
          <div className="flex flex-col gap-1.5">
            {group.keys.map((key) => (
              <label key={key} className="flex items-center justify-between gap-4 text-sm">
                <span>
                  {SETTINGS_REGISTRY[key].label}
                  {SETTINGS_REGISTRY[key].unit && (
                    <span className="text-secondary">, {SETTINGS_REGISTRY[key].unit}</span>
                  )}
                </span>
                <Input
                  type="number"
                  className="w-32 shrink-0"
                  value={draft[key] ?? settings[key]}
                  disabled={!canEdit || busy}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                  }
                />
              </label>
            ))}
          </div>
        </div>
      ))}
      {canEdit && (
        <div className="mt-4">
          <Button variant="primary" onClick={save} disabled={busy || Object.keys(draft).length === 0}>
            Сохранить настройки
          </Button>
          {message && <span className="ml-3 inline-block"><Notice>{message}</Notice></span>}
        </div>
      )}

      <GameTimeEditor gameTime={gameTime} canEdit={canEdit} onSaved={onSaved} />
    </Card>
  );
}

/** Игровой цикл: якорь + длительности фаз (план 2.1). */
function GameTimeEditor({
  gameTime,
  canEdit,
  onSaved,
}: {
  gameTime: GameTimeSettings;
  canEdit: boolean;
  onSaved: () => void;
}) {
  const [anchor, setAnchor] = useState(gameTime.gameTimeAnchor.slice(0, 16));
  const [day, setDay] = useState(gameTime.gameTimeDayMinutes);
  const [night, setNight] = useState(gameTime.gameTimeNightMinutes);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      await api('/settings/game-time', {
        method: 'PUT',
        body: JSON.stringify({
          gameTimeAnchor: new Date(anchor).toISOString(),
          gameTimeDayMinutes: day,
          gameTimeNightMinutes: night,
        }),
      });
      setMessage('Игровой цикл сохранён');
      onSaved();
    } catch {
      setMessage('Не получилось сохранить цикл');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6">
      <h3 className="mb-2 text-sm font-semibold text-secondary">Игровой цикл (план 2.1)</h3>
      <div className="flex flex-col gap-1.5">
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>Якорь цикла (момент начала дневной фазы)</span>
          <Input
            type="datetime-local"
            className="w-56 shrink-0"
            value={anchor}
            disabled={!canEdit || busy}
            onChange={(e) => setAnchor(e.target.value)}
          />
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>Дневная фаза, мин</span>
          <Input
            type="number"
            className="w-32 shrink-0"
            value={day}
            disabled={!canEdit || busy}
            onChange={(e) => setDay(Number(e.target.value))}
          />
        </label>
        <label className="flex items-center justify-between gap-4 text-sm">
          <span>Ночная фаза, мин</span>
          <Input
            type="number"
            className="w-32 shrink-0"
            value={night}
            disabled={!canEdit || busy}
            onChange={(e) => setNight(Number(e.target.value))}
          />
        </label>
      </div>
      {canEdit && (
        <div className="mt-3">
          <Button variant="primary" onClick={save} disabled={busy}>
            Сохранить цикл
          </Button>
          {message && <span className="ml-3 inline-block"><Notice>{message}</Notice></span>}
        </div>
      )}
    </div>
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
    } catch (err) {
      const status = (err as { status?: number }).status;
      setMessage(status === 409 ? 'Конфликт: такое название уже есть' : 'Не получилось');
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
                    onChange={(e) =>
                      setRenames((prev) => ({ ...prev, [type.id]: e.target.value }))
                    }
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
                        act(
                          () => api(`/event-types/${type.id}`, { method: 'DELETE' }),
                          'Удалено',
                        )
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
            ).then(() => setName(''));
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

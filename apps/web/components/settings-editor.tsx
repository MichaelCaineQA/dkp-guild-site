'use client';
import { useState } from 'react';
import {
  SETTINGS_REGISTRY,
  SETTING_DEFAULTS,
  GAME_TIME_DEFAULTS,
  gameTimeSettingsSchema,
  type SettingKey,
} from '@dkp/shared';
import { api } from '../lib/api';
import {
  Button,
  ErrorText,
  Input,
  Modal,
  Notice,
  SectionTitle,
  SettingsField,
  SettingsGroup,
  Stack,
} from './ui';
export type SettingsMap = Record<SettingKey, number>;
export interface GameTimeValue {
  gameTimeAnchor: string;
  gameTimeDayMinutes: number;
  gameTimeNightMinutes: number;
}
function issueText(issue?: { code: string; minimum?: number | bigint; maximum?: number | bigint }) {
  if (issue?.code === 'too_small') return `Значение должно быть не меньше ${issue.minimum}`;
  if (issue?.code === 'too_big') return `Значение должно быть не больше ${issue.maximum}`;
  return 'Введите допустимое целое число';
}
function ConfirmReset({
  title,
  onReset,
  onClose,
}: {
  title: string;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <Modal title={`Сбросить раздел «${title}»?`} onClose={onClose}>
      <Stack>
        <p>
          Дефолты заполнят только поля этого раздела. Серверные значения изменятся после
          «Сохранить».
        </p>
        <Button
          type="button"
          variant="primary"
          onClick={() => {
            onReset();
            onClose();
          }}
        >
          Сбросить
        </Button>
        <Button type="button" onClick={onClose}>
          Отмена
        </Button>
      </Stack>
    </Modal>
  );
}
export function SettingsEditor({
  settings,
  gameTime,
  onSettingsSaved,
  onGameTimeSaved,
}: {
  settings: SettingsMap;
  gameTime: GameTimeValue;
  onSettingsSaved: (next: SettingsMap) => void;
  onGameTimeSaved: (next: GameTimeValue) => void;
}) {
  const groups = new Map<string, SettingKey[]>();
  for (const key of Object.keys(SETTINGS_REGISTRY) as SettingKey[]) {
    const title = key.endsWith('SharePct')
      ? 'ДКП'
      : key.startsWith('checkin.')
        ? 'Чек-ин'
        : key.startsWith('absence.')
          ? 'Отсутствия'
          : key.startsWith('auction.')
            ? 'Аукцион'
            : 'Общие';
    groups.set(title, [...(groups.get(title) ?? []), key]);
  }
  return (
    <Stack>
      <SectionTitle>Настройки системы</SectionTitle>
      {[...groups].map(([title, keys]) => (
        <NumberSettingsGroup
          key={title}
          title={title}
          keys={keys}
          settings={settings}
          onSaved={onSettingsSaved}
        />
      ))}
      <GameTimeEditor value={gameTime} onSaved={onGameTimeSaved} />
    </Stack>
  );
}
function NumberSettingsGroup({
  title,
  keys,
  settings,
  onSaved,
}: {
  title: string;
  keys: SettingKey[];
  settings: SettingsMap;
  onSaved: (next: SettingsMap) => void;
}) {
  const [draft, setDraft] = useState<Partial<Record<SettingKey, string>>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const changed = keys.filter(
    (key) =>
      draft[key] !== undefined && (draft[key] === '' || Number(draft[key]) !== settings[key]),
  );
  const errors = Object.fromEntries(
    keys.map((key) => {
      const raw = draft[key] ?? String(settings[key]);
      const parsed = SETTINGS_REGISTRY[key].schema.safeParse(raw === '' ? NaN : Number(raw));
      return [key, parsed.success ? '' : issueText(parsed.error.issues[0])];
    }),
  ) as Record<SettingKey, string>;
  async function save() {
    if (busy || keys.some((key) => errors[key])) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await api<SettingsMap>('/settings', {
        method: 'PUT',
        body: JSON.stringify(Object.fromEntries(changed.map((key) => [key, Number(draft[key])]))),
      });
      onSaved(result);
      setDraft({});
      setMessage('Сохранено');
    } catch {
      setError('Не удалось сохранить. Введённые значения сохранены — повторите попытку.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsGroup title={title}>
      {keys.map((key) => (
        <SettingsField
          key={key}
          id={key}
          label={`${SETTINGS_REGISTRY[key].label}${SETTINGS_REGISTRY[key].unit ? ', ' + SETTINGS_REGISTRY[key].unit : ''}`}
          error={errors[key]}
        >
          <Input
            id={key}
            aria-invalid={!!errors[key]}
            aria-describedby={errors[key] ? `${key}-error` : undefined}
            type="number"
            step={1}
            className="w-40"
            value={draft[key] ?? settings[key]}
            disabled={busy}
            onChange={(e) => {
              setDraft((current) => ({ ...current, [key]: e.target.value }));
              setMessage('');
            }}
          />
        </SettingsField>
      ))}
      <div className="flex flex-wrap gap-3">
        {changed.length > 0 && (
          <Button
            variant="primary"
            disabled={busy || keys.some((key) => errors[key])}
            onClick={() => {
              void save();
            }}
          >
            Сохранить
          </Button>
        )}
        <Button disabled={busy} onClick={() => setConfirm(true)}>
          Сбросить к дефолтам
        </Button>
      </div>
      {error && (
        <div role="alert">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {message && <Notice tone="success">{message}</Notice>}
      {confirm && (
        <ConfirmReset
          title={title}
          onClose={() => setConfirm(false)}
          onReset={() => {
            setDraft((current) => ({
              ...current,
              ...Object.fromEntries(keys.map((key) => [key, String(SETTING_DEFAULTS[key])])),
            }));
            setMessage('');
            setError('');
          }}
        />
      )}
    </SettingsGroup>
  );
}
function localInput(iso: string) {
  const date = new Date(iso);
  return new Date(+date - date.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
function GameTimeEditor({
  value,
  onSaved,
}: {
  value: GameTimeValue;
  onSaved: (next: GameTimeValue) => void;
}) {
  const [draft, setDraft] = useState<Partial<Record<keyof GameTimeValue, string>>>({});
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const anchor = draft.gameTimeAnchor ?? localInput(value.gameTimeAnchor);
  const date = new Date(anchor);
  const payload = {
    gameTimeAnchor:
      anchor === localInput(value.gameTimeAnchor) ||
      anchor === localInput(value.gameTimeAnchor).replace(/:00$/, '')
        ? value.gameTimeAnchor
        : Number.isFinite(+date)
          ? date.toISOString()
          : '',
    gameTimeDayMinutes: Number(draft.gameTimeDayMinutes ?? value.gameTimeDayMinutes),
    gameTimeNightMinutes: Number(draft.gameTimeNightMinutes ?? value.gameTimeNightMinutes),
  };
  const parsed = gameTimeSettingsSchema.safeParse(payload);
  const errors = parsed.success
    ? {}
    : Object.fromEntries(
        parsed.error.issues.map((issue) => [
          issue.path[0],
          issue.path[0] === 'gameTimeAnchor' ? 'Введите дату и время' : issueText(issue),
        ]),
      );
  const changed =
    payload.gameTimeAnchor !== value.gameTimeAnchor ||
    payload.gameTimeDayMinutes !== value.gameTimeDayMinutes ||
    payload.gameTimeNightMinutes !== value.gameTimeNightMinutes;
  async function save() {
    if (!parsed.success || busy) return;
    setBusy(true);
    setMessage('');
    setError('');
    try {
      const result = await api<GameTimeValue>('/settings/game-time', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      onSaved(result);
      setDraft({});
      setMessage('Сохранено');
    } catch {
      setError('Не удалось сохранить цикл. Введённые значения сохранены.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <SettingsGroup title="Игровой цикл">
      <p>Якорь — в вашей таймзоне. Сброс длительностей сохраняет известную привязку.</p>
      <SettingsField
        id="gameTimeAnchor"
        label="Якорь цикла (начало дневной фазы)"
        error={errors.gameTimeAnchor}
      >
        <Input
          id="gameTimeAnchor"
          type="datetime-local"
          step={1}
          className="w-64"
          value={anchor}
          disabled={busy}
          aria-invalid={!!errors.gameTimeAnchor}
          onChange={(e) => setDraft((current) => ({ ...current, gameTimeAnchor: e.target.value }))}
        />
      </SettingsField>
      {(['gameTimeDayMinutes', 'gameTimeNightMinutes'] as const).map((key) => (
        <SettingsField
          key={key}
          id={key}
          label={key === 'gameTimeDayMinutes' ? 'Дневная фаза, мин' : 'Ночная фаза, мин'}
          error={errors[key]}
        >
          <Input
            id={key}
            type="number"
            step={1}
            className="w-40"
            value={draft[key] ?? value[key]}
            disabled={busy}
            aria-invalid={!!errors[key]}
            onChange={(e) => setDraft((current) => ({ ...current, [key]: e.target.value }))}
          />
        </SettingsField>
      ))}
      <div className="flex flex-wrap gap-3">
        {changed && (
          <Button
            variant="primary"
            disabled={busy || !parsed.success}
            onClick={() => {
              void save();
            }}
          >
            Сохранить
          </Button>
        )}
        <Button disabled={busy} onClick={() => setConfirm(true)}>
          Сбросить к дефолтам
        </Button>
      </div>
      {error && (
        <div role="alert">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {message && <Notice tone="success">{message}</Notice>}
      {confirm && (
        <ConfirmReset
          title="Игровой цикл"
          onClose={() => setConfirm(false)}
          onReset={() => {
            setDraft((current) => ({
              ...current,
              gameTimeDayMinutes: String(GAME_TIME_DEFAULTS.gameTimeDayMinutes),
              gameTimeNightMinutes: String(GAME_TIME_DEFAULTS.gameTimeNightMinutes),
            }));
            setMessage('');
            setError('');
          }}
        />
      )}
    </SettingsGroup>
  );
}

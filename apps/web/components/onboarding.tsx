'use client';
import { useEffect, useState, type FormEvent } from 'react';
import {
  COMBAT_ROLES,
  COMBAT_ROLE_LABELS,
  SCREENSHOT_MAX_BYTES,
  SCREENSHOT_MIME_TYPES,
  createLinkRequestSchema,
  type CombatRole,
  type Weapon,
  type OnboardingRequest,
} from '@dkp/shared';
import { api, API_URL_VALUE } from '../lib/api';
import { useSession } from './session-context';
import {
  TextLink,
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Notice,
  Page,
  PageHeader,
  Select,
  Stack,
  WeaponPicker,
} from './ui';

export function ScreenshotLinks({ ids }: { ids: string[] }) {
  return (
    <ul className="flex flex-wrap gap-3">
      {ids.map((id, index) => (
        <li key={id}>
          <TextLink
            href={`${API_URL_VALUE}/screenshots/${encodeURIComponent(id)}`}
            target="_blank"
            rel="noreferrer"
          >
            Скриншот {index + 1}
          </TextLink>
        </li>
      ))}
    </ul>
  );
}
export function OnboardingScreen() {
  const { reload } = useSession();
  const [request, setRequest] = useState<OnboardingRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [editing, setEditing] = useState(false);
  const [nickname, setNickname] = useState('');
  const [role, setRole] = useState<CombatRole | ''>('');
  const [weapons, setWeapons] = useState<Array<Weapon | ''>>([]);
  const [gs, setGs] = useState('');
  const [ids, setIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const load = async () => {
    setLoading(true);
    setLoadFailed(false);
    setError('');
    try {
      const { request: value } = await api<{ request: OnboardingRequest | null }>(
        '/auth/link-request',
      );
      setRequest(value);
      setNickname(value?.nickname ?? '');
      setRole(value?.combatRole ?? '');
      setWeapons(value?.weapons ?? []);
      setGs(value?.gearScore?.toString() ?? '');
      setIds(value?.screenshotIds ?? []);
      setEditing(!value);
    } catch {
      setLoadFailed(true);
      setError('Не удалось загрузить анкету. Обновите страницу.');
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    setError('');
    const selected = Array.from(files);
    if (
      selected.some(
        (file) =>
          file.size > SCREENSHOT_MAX_BYTES ||
          !SCREENSHOT_MIME_TYPES.includes(file.type as (typeof SCREENSHOT_MIME_TYPES)[number]),
      )
    ) {
      setError('Выберите PNG, JPG/JPEG или WebP. Каждый файл — до 10 МБ включительно.');
      return;
    }
    setUploading(true);
    try {
      for (const file of selected) {
        const data = new FormData();
        data.append('file', file);
        const result = await api<{ id: string }>('/screenshots', { method: 'POST', body: data });
        setIds((current) => [...current, result.id]);
      }
    } catch {
      setError('Не удалось загрузить скриншот. Проверьте формат и повторите попытку.');
    } finally {
      setUploading(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || uploading) return;
    const parsed = createLinkRequestSchema.safeParse({
      nickname,
      combatRole: role,
      weapons,
      gearScore: Number(gs),
      screenshotIds: ids,
    });
    if (!parsed.success) {
      setError(
        'Заполните ник, роль, два разных оружия, положительный целый GS и добавьте скриншот.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api('/auth/link-request', { method: 'POST', body: JSON.stringify(parsed.data) });
      await load();
    } catch (err) {
      setError(
        (err as { status?: number }).status === 409
          ? 'Ник уже занят или анкета изменилась. Проверьте данные.'
          : 'Не удалось сохранить анкету. Попробуйте ещё раз.',
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <Page width="narrow">
      <PageHeader
        title={request && !editing ? 'Ожидание одобрения' : 'Анкета вступления'}
        subtitle="Добро пожаловать в гильдию"
      />
      {error && (
        <div role="alert">
          <ErrorText>{error}</ErrorText>
        </div>
      )}
      {loading ? (
        <p>Загрузка анкеты…</p>
      ) : loadFailed ? (
        <Button
          onClick={() => {
            void load();
          }}
        >
          Повторить загрузку
        </Button>
      ) : (
        <Card>
          <Stack>
            {request && !editing ? (
              <>
                <Notice>
                  Анкета отправлена. Глава или Админ откроет доступ после одобрения. Срок ожидания
                  не ограничен.
                </Notice>
                <p className="text-xl font-semibold">{request.nickname}</p>
                <p>GS: {request.gearScore ?? 'не указан'}</p>
                <ScreenshotLinks ids={request.screenshotIds} />
                <Button onClick={() => setEditing(true)}>Редактировать анкету</Button>
                <Button
                  onClick={async () => {
                    await reload();
                  }}
                >
                  Проверить одобрение
                </Button>
              </>
            ) : (
              <form onSubmit={submit}>
                <fieldset className="min-w-0" disabled={busy || uploading}>
                  <Stack>
                    <Field label="Игровой ник">
                      <Input
                        required
                        minLength={2}
                        maxLength={40}
                        value={nickname}
                        onChange={(e) => setNickname(e.target.value)}
                      />
                    </Field>
                    <WeaponPicker value={weapons} onChange={setWeapons} />
                    <Field label="Роль в бою">
                      <Select
                        required
                        value={role}
                        onChange={(e) => setRole(e.target.value as CombatRole)}
                      >
                        <option value="" disabled>
                          Выберите роль
                        </option>
                        {COMBAT_ROLES.map((value) => (
                          <option key={value} value={value}>
                            {COMBAT_ROLE_LABELS[value]}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="GS">
                      <Input
                        required
                        type="number"
                        min={1}
                        step={1}
                        value={gs}
                        onChange={(e) => setGs(e.target.value)}
                      />
                    </Field>
                    <p className="text-sm text-secondary">
                      На скриншоте должны быть видны ваш ник и GS. PNG, JPG/JPEG или WebP, каждый
                      файл до 10 МБ. Можно добавить несколько.
                    </p>
                    <Field label="Скриншоты профиля">
                      <Input
                        className="w-full"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        multiple
                        onChange={(e) => {
                          void upload(e.target.files);
                          e.target.value = '';
                        }}
                      />
                    </Field>
                    <ScreenshotLinks ids={ids} />
                    {ids.map((id, i) => (
                      <Button
                        type="button"
                        key={id}
                        onClick={() => setIds((current) => current.filter((value) => value !== id))}
                      >
                        Убрать скриншот {i + 1}
                      </Button>
                    ))}
                    <Button type="submit" variant="primary">
                      {busy ? 'Сохранение…' : 'Отправить анкету'}
                    </Button>
                    {request && (
                      <Button
                        type="button"
                        onClick={() => {
                          void load();
                        }}
                      >
                        Отменить изменения
                      </Button>
                    )}
                  </Stack>
                </fieldset>
                {uploading && <p role="status">Загрузка скриншотов…</p>}
              </form>
            )}
          </Stack>
        </Card>
      )}
      <Button
        className="mt-4"
        disabled={busy || uploading}
        onClick={async () => {
          await api('/auth/logout', { method: 'POST' });
          await reload();
        }}
      >
        Выйти
      </Button>
    </Page>
  );
}

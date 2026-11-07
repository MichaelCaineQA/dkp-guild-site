'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import {
  COMBAT_ROLES,
  COMBAT_ROLE_LABELS,
  can,
  canEditOwnProfile,
  updateOwnProfileSchema,
  type CombatRole,
  type Weapon,
  type PlayerProfile,
  AVATARS,
  AVATAR_COLORS,
  type AvatarColor,
  type Avatar as AvatarId,
} from '@dkp/shared';
import { Avatar, avatarLabel, AVATAR_PALETTE } from '../../../components/avatar';
import { useSession } from '../../../components/session-context';
import { ScreenshotLinks } from '../../../components/onboarding';
import { api } from '../../../lib/api';
import {
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Notice,
  Page,
  PageHeader,
  ProfileDetails,
  ProfileHistory,
  SectionTitle,
  Select,
  Stack,
  WeaponPicker,
} from '../../../components/ui';

export default function ProfilePage() {
  const { memberId } = useParams<{ memberId: string }>();
  const { user, loading: sessionLoading } = useSession();
  const actor = { rank: user?.rank ?? null, memberId: user?.memberId, isAdmin: user?.isAdmin };
  const allowed = !!user && can(actor, 'profile.view');
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState('');
  const [role, setRole] = useState<CombatRole | ''>('');
  const [avatar, setAvatar] = useState<AvatarId | null>(null);
  const [avatarColor, setAvatarColor] = useState<AvatarColor | null>(null);
  const [weapons, setWeapons] = useState<Array<Weapon | ''>>([]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    if (!allowed) return;
    let active = true;
    setProfile(null);
    setError('');
    setMessage('');
    setComment('');
    setSaveError('');
    api<PlayerProfile>(`/profiles/${encodeURIComponent(memberId)}`)
      .then((data) => {
        if (active) {
          setProfile(data);
          setAvatar(data.avatar ?? null);
          setAvatarColor(data.avatarColor ?? null);
          setRole(data.combatRole ?? '');
          setWeapons(data.weapons ?? []);
        }
      })
      .catch((err: { status?: number }) => {
        if (active)
          setError(
            err.status === 404
              ? 'Игрок не найден'
              : err.status === 403
                ? 'Нет доступа к профилю'
                : 'Не удалось загрузить профиль',
          );
      });
    return () => {
      active = false;
    };
  }, [allowed, memberId]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const input = updateOwnProfileSchema.safeParse({
      combatRole: role,
      weapons,
      avatar,
      avatarColor,
      comment,
    });
    setSaveError('');
    setMessage('');
    if (!input.success) {
      setSaveError('Выберите роль, два разных оружия и укажите комментарий от 3 до 500 символов');
      return;
    }
    setBusy(true);
    try {
      await api(`/profiles/${encodeURIComponent(memberId)}`, {
        method: 'PATCH',
        body: JSON.stringify(input.data),
      });
      setProfile((current) =>
        current?.id === memberId
          ? {
              ...current,
              combatRole: input.data.combatRole,
              weapons: input.data.weapons,
              avatar: input.data.avatar,
              avatarColor: input.data.avatarColor,
            }
          : current,
      );
      setComment('');
      window.dispatchEvent(new Event('profile:changed'));
      setMessage('Профиль сохранён');
    } catch (err) {
      setSaveError(
        (err as { status?: number }).status === 403
          ? 'Можно менять только свой профиль'
          : 'Не удалось сохранить профиль. Попробуйте ещё раз.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (sessionLoading) return <Page>Загрузка…</Page>;
  if (!allowed)
    return (
      <Page>
        <PageHeader title="Профиль игрока" />
        <Notice>Профили доступны только членам гильдии после входа.</Notice>
      </Page>
    );
  if (error)
    return (
      <Page>
        <PageHeader title="Профиль игрока" />
        <div role="alert">
          <ErrorText>{error}</ErrorText>
        </div>
      </Page>
    );
  if (!profile || profile.id !== memberId) return <Page>Загрузка профиля…</Page>;

  return (
    <Page>
      <Stack>
        <PageHeader title={`Профиль: ${profile.nickname}`} />
        <ProfileDetails profile={profile} />
        {profile.gearScore && (
          <Card>
            <SectionTitle>GS: {profile.gearScore.value}</SectionTitle>
            <p className="mb-3 text-sm text-secondary">
              Обновлён {new Date(profile.gearScore.createdAt).toLocaleDateString('ru-RU')}
            </p>
            <ScreenshotLinks ids={profile.gearScore.screenshotIds} />
          </Card>
        )}
        {canEditOwnProfile(actor, memberId) && (
          <Card>
            <SectionTitle>Изменить профиль</SectionTitle>
            {(!profile.combatRole || (profile.weapons ?? []).length !== 2) && (
              <Notice>
                Заполните роль и два оружия. Старые данные сохранены, оружия автоматически не
                назначались.
              </Notice>
            )}
            <form onSubmit={save}>
              <fieldset disabled={busy}>
                <Stack>
                  <fieldset>
                    <legend className="mb-2 font-medium">Аватар</legend>
                    <p className="mb-3 text-sm text-secondary">
                      Выберите иконку — {AVATARS.length} варианта
                    </p>
                    <div className="grid max-h-[28rem] grid-cols-3 gap-2 overflow-y-auto p-1 sm:grid-cols-4 lg:grid-cols-6">
                      {AVATARS.map((value) => (
                        <label
                          key={value}
                          className={`relative flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 p-2 text-xs transition hover:bg-accent-soft has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${avatar === value ? 'border-accent bg-accent-soft' : 'border-transparent'}`}
                        >
                          <input
                            type="radio"
                            className="sr-only"
                            name="avatar"
                            checked={avatar === value}
                            onChange={() => setAvatar(value)}
                            aria-label={avatarLabel(value)}
                          />
                          <Avatar
                            avatar={value}
                            avatarColor={avatarColor}
                            nickname={profile.nickname}
                            size="large"
                          />
                          {avatar === value && (
                            <span
                              aria-hidden="true"
                              className="absolute right-1 top-1 rounded-full bg-accent px-1 text-white"
                            >
                              ✓
                            </span>
                          )}
                          {avatarLabel(value)}
                        </label>
                      ))}
                      <label
                        className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 p-2 text-center text-xs has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${avatar === null ? 'border-accent bg-accent-soft' : 'border-transparent'}`}
                      >
                        <input
                          type="radio"
                          className="sr-only"
                          name="avatar"
                          checked={avatar === null}
                          onChange={() => setAvatar(null)}
                        />
                        <Avatar avatar={null} nickname={profile.nickname} size="large" />
                        По умолчанию
                      </label>
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend className="mb-2 font-medium">Цвет фона</legend>
                    <div className="flex flex-wrap gap-2">
                      {AVATAR_COLORS.map((value) => (
                        <label
                          key={value}
                          className={`relative cursor-pointer rounded-xl border-2 p-1 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${avatarColor === value ? 'border-accent' : 'border-transparent'}`}
                          title={AVATAR_PALETTE[value].label}
                        >
                          <input
                            type="radio"
                            className="sr-only"
                            name="avatarColor"
                            aria-label={AVATAR_PALETTE[value].label}
                            checked={avatarColor === value}
                            onChange={() => setAvatarColor(value)}
                          />
                          <span
                            className="flex h-10 w-10 items-center justify-center rounded-lg text-white"
                            style={{ backgroundColor: AVATAR_PALETTE[value].color }}
                          >
                            {avatarColor === value ? '✓' : ''}
                          </span>
                        </label>
                      ))}
                      <label className="flex cursor-pointer items-center gap-2 p-2 text-sm">
                        <input
                          type="radio"
                          name="avatarColor"
                          checked={avatarColor === null}
                          onChange={() => setAvatarColor(null)}
                        />
                        Автоматически
                      </label>
                    </div>
                    <div className="mt-3 flex items-center gap-3">
                      <Avatar
                        avatar={avatar}
                        avatarColor={avatarColor}
                        nickname={profile.nickname}
                        size="profile"
                      />
                      <span className="text-sm text-secondary">Предпросмотр</span>
                    </div>
                  </fieldset>
                  <Field label="Роль">
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
                  <WeaponPicker value={weapons} onChange={setWeapons} />
                  <Field label="Комментарий">
                    <Input
                      required
                      minLength={3}
                      maxLength={500}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </Field>
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={
                      role === profile.combatRole &&
                      avatar === (profile.avatar ?? null) &&
                      avatarColor === (profile.avatarColor ?? null) &&
                      JSON.stringify(weapons) === JSON.stringify(profile.weapons ?? [])
                    }
                  >
                    {busy ? 'Сохранение…' : 'Сохранить профиль'}
                  </Button>
                </Stack>
              </fieldset>
            </form>
            {saveError && (
              <div role="alert">
                <ErrorText>{saveError}</ErrorText>
              </div>
            )}
            {message && <p role="status">{message}</p>}
          </Card>
        )}
        <ProfileHistory entries={profile.recentEntries} />
      </Stack>
    </Page>
  );
}

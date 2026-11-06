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
  type PlayerProfile,
} from '@dkp/shared';
import { useSession } from '../../../components/session-context';
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
} from '../../../components/ui';

export default function ProfilePage() {
  const { memberId } = useParams<{ memberId: string }>();
  const { user, loading: sessionLoading } = useSession();
  const actor = { rank: user?.rank ?? null, memberId: user?.memberId, isAdmin: user?.isAdmin };
  const allowed = !!user && can(actor, 'profile.view');
  const [profile, setProfile] = useState<PlayerProfile | null>(null);
  const [error, setError] = useState('');
  const [role, setRole] = useState<CombatRole | ''>('');
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
          setRole(data.combatRole ?? '');
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
    const input = updateOwnProfileSchema.safeParse({ combatRole: role, comment });
    setSaveError('');
    setMessage('');
    if (!input.success) {
      setSaveError('Выберите роль и укажите комментарий от 3 до 500 символов');
      return;
    }
    setBusy(true);
    try {
      await api(`/profiles/${encodeURIComponent(memberId)}`, {
        method: 'PATCH',
        body: JSON.stringify(input.data),
      });
      setProfile((current) =>
        current?.id === memberId ? { ...current, combatRole: input.data.combatRole } : current,
      );
      setComment('');
      setMessage('Роль в бою сохранена');
    } catch (err) {
      setSaveError(
        (err as { status?: number }).status === 403
          ? 'Можно менять только свою роль в бою'
          : 'Не удалось сохранить роль. Попробуйте ещё раз.',
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
        {canEditOwnProfile(actor, memberId) && (
          <Card>
            <SectionTitle>Изменить свою роль в бою</SectionTitle>
            <form onSubmit={save}>
              <fieldset disabled={busy}>
                <Stack>
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
                  <Field label="Комментарий">
                    <Input
                      required
                      minLength={3}
                      maxLength={500}
                      value={comment}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </Field>
                  <Button type="submit" variant="primary" disabled={role === profile.combatRole}>
                    {busy ? 'Сохранение…' : 'Сохранить роль'}
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

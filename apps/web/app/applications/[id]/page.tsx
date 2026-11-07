'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { can, COMBAT_ROLE_LABELS, formatWeapons, type OnboardingRequest } from '@dkp/shared';
import { api } from '../../../lib/api';
import { useSession } from '../../../components/session-context';
import { ScreenshotLinks } from '../../../components/onboarding';
import {
  TextLink,
  Button,
  Card,
  ErrorText,
  Notice,
  Page,
  PageHeader,
  Stack,
} from '../../../components/ui';
export default function ApplicationProfile() {
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useSession();
  const allowed = !!user && can(user, 'link_requests.review');
  const [request, setRequest] = useState<OnboardingRequest | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  useEffect(() => {
    if (!allowed) return;
    let active = true;
    setRequest(null);
    setError('');
    setAccepted(false);
    api<OnboardingRequest>(`/auth/link-requests/${encodeURIComponent(id)}`)
      .then((value) => {
        if (active) setRequest(value);
      })
      .catch(() => {
        if (active) setError('Анкета не найдена или уже принята');
      });
    return () => {
      active = false;
    };
  }, [allowed, id]);
  if (loading) return <Page>Загрузка…</Page>;
  if (!allowed)
    return (
      <Page>
        <Notice>Анкеты доступны Главе и Админу.</Notice>
      </Page>
    );
  return (
    <Page width="narrow">
      <PageHeader title="Профиль заявителя" />
      <Stack>
        {error && <ErrorText>{error}</ErrorText>}
        {accepted ? (
          <Notice tone="success">Игрок принят в гильдию.</Notice>
        ) : request ? (
          <Card>
            <Stack>
              <h2 className="text-2xl font-semibold">{request.nickname}</h2>
              <p>Discord: {request.user?.username}</p>
              <p>
                Роль: {request.combatRole ? COMBAT_ROLE_LABELS[request.combatRole] : 'не указана'}
              </p>
              <p>Класс: {formatWeapons(request.weapons)}</p>
              <p>GS: {request.gearScore ?? 'не указан'}</p>
              <ScreenshotLinks ids={request.screenshotIds} />
              <Button
                variant="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    await api(`/auth/link-requests/${encodeURIComponent(id)}/approve`, {
                      method: 'POST',
                    });
                    setAccepted(true);
                  } catch {
                    setError(
                      'Не удалось принять анкету. Проверьте её актуальность и обязательные поля.',
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Принять в гильдию
              </Button>
            </Stack>
          </Card>
        ) : (
          !error && <p>Загрузка анкеты…</p>
        )}
        <TextLink href="/link-requests">Все заявки</TextLink>
      </Stack>
    </Page>
  );
}

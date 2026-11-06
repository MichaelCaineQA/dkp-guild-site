'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'next/navigation';
import {
  can,
  rulesSlugSchema,
  RULES_TITLES,
  updateRulesSchema,
  restoreRulesSchema,
  type RulesPageDto,
  type RulesVersionDto,
  type RulesVersionSummary,
} from '@dkp/shared';
import { useSession } from '../../../components/session-context';
import { api } from '../../../lib/api';
import {
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Muted,
  Notice,
  Page,
  PageHeader,
  SectionTitle,
  Select,
} from '../../../components/ui';
import { RulesEditor, RulesLayout, RulesMarkdown } from '../../../components/ui/rules';

export default function RulesPage() {
  const { slug } = useParams<{ slug: string }>();
  const parsedSlug = rulesSlugSchema.safeParse(slug);
  const { user, loading: sessionLoading } = useSession();
  const actor = { rank: user?.rank ?? null, memberId: user?.memberId, isAdmin: user?.isAdmin };
  const allowed = !!user && can(actor, 'members.view_roster');
  const editable = !!user && can(actor, 'rules.edit');
  const [page, setPage] = useState<RulesPageDto | null>(null);
  const [history, setHistory] = useState<RulesVersionSummary[]>([]);
  const [selected, setSelected] = useState('');
  const [version, setVersion] = useState<RulesVersionDto | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [baseVersion, setBaseVersion] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [versionError, setVersionError] = useState('');
  const [message, setMessage] = useState('');
  const [conflict, setConflict] = useState(false);
  const validSlug = parsedSlug.success;
  const path = `/rules/${encodeURIComponent(slug)}`;

  useEffect(() => {
    if (!allowed || !validSlug) return;
    let active = true;
    setPage(null);
    setError('');
    setEditing(false);
    setSelected('');
    setMessage('');
    setConflict(false);
    setComment('');
    Promise.all([api<RulesPageDto>(path), api<RulesVersionSummary[]>(`${path}/versions`)])
      .then(([current, versions]) => {
        if (active) {
          setPage(current);
          setHistory(versions);
        }
      })
      .catch((err: { status?: number }) => {
        if (active)
          setError(
            err.status === 404 ? 'Страница правил не найдена' : 'Не удалось загрузить правила',
          );
      });
    return () => {
      active = false;
    };
  }, [allowed, validSlug, path]);

  useEffect(() => {
    setVersion(null);
    setVersionError('');
    if (!allowed || !validSlug || !selected) return;
    let active = true;
    api<RulesVersionDto>(`${path}/versions/${selected}`)
      .then((data) => {
        if (active) setVersion(data);
      })
      .catch(() => {
        if (active) setVersionError('Не удалось загрузить версию');
      });
    return () => {
      active = false;
    };
  }, [allowed, validSlug, path, selected]);

  async function publish(event: FormEvent<HTMLFormElement>, restore: boolean) {
    event.preventDefault();
    if (!page || busy) return;
    setError('');
    setMessage('');
    const input = restore
      ? restoreRulesSchema.safeParse({
          sourceVersion: version?.version,
          expectedVersion: page.version,
          comment,
        })
      : updateRulesSchema.safeParse({ contentMd: draft, expectedVersion: baseVersion, comment });
    if (!input.success) {
      setError('Проверьте текст правил и комментарий от 3 до 500 символов');
      return;
    }
    setBusy(true);
    try {
      const current = await api<RulesPageDto>(restore ? `${path}/restore` : path, {
        method: restore ? 'POST' : 'PUT',
        body: JSON.stringify(input.data),
      });
      setPage(current);
      setEditing(false);
      setConflict(false);
      setComment('');
      setSelected('');
      setMessage(`Опубликована версия ${current.version}`);
      await api<RulesVersionSummary[]>(`${path}/versions`)
        .then(setHistory)
        .catch(() => {
          setError('Правила опубликованы, но историю обновить не удалось. Обновите страницу.');
        });
    } catch (err) {
      if ((err as { status?: number }).status === 409) {
        setError(
          restore
            ? 'Правила уже изменились. Проверьте актуальный текст перед повторным восстановлением.'
            : 'Правила уже изменились. Черновик сохранён в редакторе. Сравните его с актуальным текстом выше.',
        );
        try {
          setPage(await api<RulesPageDto>(path));
          setConflict(!restore);
        } catch {
          setError('Правила изменились. Скопируйте черновик перед обновлением страницы.');
        }
      } else
        setError(
          'Не удалось опубликовать правила. Проверьте текущую версию перед повторной отправкой.',
        );
    } finally {
      setBusy(false);
    }
  }

  if (sessionLoading) return <Page>Загрузка…</Page>;
  if (!allowed)
    return (
      <Page>
        <PageHeader title="Правила" />
        <Notice>Правила доступны членам гильдии после входа.</Notice>
      </Page>
    );
  if (!parsedSlug.success)
    return (
      <Page>
        <PageHeader title="Страница правил не найдена" />
      </Page>
    );
  if (!page || page.slug !== slug)
    return (
      <Page>
        <PageHeader title={RULES_TITLES[parsedSlug.data]} />
        {error ? (
          <div role="alert">
            <ErrorText>{error}</ErrorText>
          </div>
        ) : (
          'Загрузка правил…'
        )}
      </Page>
    );
  return (
    <Page>
      <RulesLayout>
        <PageHeader
          title={page.title}
          subtitle={`Версия ${page.version} · ${new Date(page.updatedAt).toLocaleString('ru-RU')}`}
        />
        <Card>
          <RulesMarkdown content={page.contentMd} />
        </Card>
        {error && (
          <div role="alert">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
        {message && <p role="status">{message}</p>}
        {editable && !editing && (
          <Button
            onClick={() => {
              setEditing(true);
              setDraft(page.contentMd);
              setBaseVersion(page.version);
              setComment('');
              setError('');
              setConflict(false);
            }}
          >
            Редактировать
          </Button>
        )}
        {editable && editing && (
          <Card>
            <SectionTitle>Редактирование правил</SectionTitle>
            <form onSubmit={(event) => void publish(event, false)}>
              <fieldset disabled={busy}>
                <RulesLayout>
                  <RulesEditor value={draft} onChange={setDraft} />
                  <SectionTitle>Предпросмотр</SectionTitle>
                  <RulesMarkdown content={draft} />
                  <Field label="Комментарий">
                    <Input
                      required
                      minLength={3}
                      maxLength={500}
                      value={comment}
                      onChange={(event) => setComment(event.target.value)}
                    />
                  </Field>
                  {conflict && (
                    <Button
                      type="button"
                      onClick={() => {
                        setBaseVersion(page.version);
                        setConflict(false);
                        setError('');
                      }}
                    >
                      Продолжить с актуальной версией
                    </Button>
                  )}
                  <Button type="submit" variant="primary" disabled={conflict}>
                    {busy ? 'Публикация…' : 'Опубликовать'}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setError('');
                    }}
                  >
                    Отменить редактирование
                  </Button>
                </RulesLayout>
              </fieldset>
            </form>
          </Card>
        )}
        <Card>
          <RulesLayout>
            <SectionTitle>История версий</SectionTitle>
            <Field label="Версия">
              <Select
                value={selected}
                disabled={busy}
                onChange={(event) => setSelected(event.target.value)}
              >
                <option value="">Выберите версию</option>
                {history.map((item) => (
                  <option key={item.version} value={item.version}>
                    {item.version} · {new Date(item.createdAt).toLocaleString('ru-RU')}
                  </option>
                ))}
              </Select>
            </Field>
            {versionError && <ErrorText>{versionError}</ErrorText>}
            {selected && !version && !versionError && <Muted>Загрузка версии…</Muted>}
            {version && (
              <>
                <SectionTitle>Версия {version.version}</SectionTitle>
                <RulesMarkdown content={version.contentMd} />
              </>
            )}
            {editable && !editing && version && version.version !== page.version && (
              <form onSubmit={(event) => void publish(event, true)}>
                <fieldset disabled={busy}>
                  <RulesLayout>
                    <Muted>Восстановление создаст новую версию. История останется доступной.</Muted>
                    <Field label="Причина восстановления">
                      <Input
                        required
                        minLength={3}
                        maxLength={500}
                        value={comment}
                        onChange={(event) => setComment(event.target.value)}
                      />
                    </Field>
                    <Button type="submit" variant="primary">
                      {busy ? 'Восстановление…' : `Восстановить версию ${version.version}`}
                    </Button>
                  </RulesLayout>
                </fieldset>
              </form>
            )}
          </RulesLayout>
        </Card>
      </RulesLayout>
    </Page>
  );
}

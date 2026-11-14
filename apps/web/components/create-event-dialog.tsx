'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { createEventApiSchema, createEventSeriesSchema, generateSeriesEvents } from '@dkp/shared';
import { api } from '../lib/api';
import { Button, ErrorText, Field, Input, Muted, Select } from './ui';

const DAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

export function CreateEventDialog({
  series = false,
  onClose,
  onCreated,
}: {
  series?: boolean;
  onClose: () => void;
  onCreated: (startsAt: Date, message: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [types, setTypes] = useState<Array<{ id: string; name: string }>>([]);
  const [members, setMembers] = useState<Array<{ id: string; nickname: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState('');
  const [duration, setDuration] = useState('60');
  const [repeat, setRepeat] = useState<'NONE' | 'DAILY' | 'WEEKLY'>(series ? 'WEEKLY' : 'NONE');
  const [until, setUntil] = useState('');
  const repeating = repeat !== 'NONE';
  const [weekdays, setWeekdays] = useState<number[]>([]);

  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    Promise.all([
      api<Array<{ id: string; name: string }>>('/event-types'),
      api<Array<{ id: string; nickname: string }>>('/members'),
    ])
      .then(([eventTypes, roster]) => {
        if (active) {
          setTypes(eventTypes);
          setMembers(roster);
        }
      })
      .catch(() => {
        if (active)
          setError(
            'Не удалось загрузить типы ивентов и состав. Закройте форму и попробуйте снова.',
          );
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const startsAt = new Date(start);
  const endsAt = new Date(startsAt.getTime() + Number(duration) * 60_000);
  // Дни в форме местные, генератор API работает с днями недели UTC.
  const dayOffset = Number.isFinite(startsAt.getTime())
    ? startsAt.getUTCDay() - startsAt.getDay()
    : 0;
  const utcWeekdays = [...new Set([...weekdays, startsAt.getDay()])].map(
    (day) => (day + dayOffset + 7) % 7,
  );
  const previewInput = createEventSeriesSchema.safeParse({
    name: 'Предпросмотр серии',
    eventTypeId: 'preview',
    raidLeadId: 'preview',
    mode: 'PVE',
    dkpReward: 1,
    startsAt,
    endsAt,
    repeat: repeating ? repeat : 'WEEKLY',
    until: new Date(`${until}T23:59:59.999`),
    weekdays: utcWeekdays,
  });
  let slots: ReturnType<typeof generateSeriesEvents> = [];
  let previewError = '';
  if (repeating && previewInput.success && endsAt > startsAt) {
    try {
      slots = generateSeriesEvents(previewInput.data);
    } catch (error) {
      previewError = error instanceof Error ? error.message : 'Некорректная серия';
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    const data = new FormData(event.currentTarget);
    const input = {
      name: data.get('name'),
      eventTypeId: data.get('eventTypeId'),
      mode: data.get('mode'),
      raidLeadId: data.get('raidLeadId'),
      dkpReward: Number(data.get('dkpReward')),
      startsAt,
      endsAt,
      place: data.get('place'),
      notes: data.get('notes'),
      ...(repeating
        ? { repeat, until: new Date(`${until}T23:59:59.999`), weekdays: utcWeekdays }
        : {}),
    };
    const parsed = (repeating ? createEventSeriesSchema : createEventApiSchema).safeParse(input);
    if (!parsed.success || !(endsAt > startsAt) || !!previewError) {
      setError('Проверьте обязательные поля, дату, длительность и целую положительную плату ДКП.');
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ created?: number }>(repeating ? '/events/series' : '/events', {
        method: 'POST',
        body: JSON.stringify(parsed.data),
      });
      onCreated(startsAt, repeating ? `Создана серия: ${result.created} ивентов` : 'Ивент создан');
    } catch (err) {
      const status = (err as { status?: number }).status;
      setError(
        status === 403
          ? 'Нет прав на создание ивентов.'
          : status === 404
            ? 'Тип ивента или рейд-лид больше недоступен. Откройте форму заново.'
            : 'Не удалось создать ивент. Проверьте расписание перед повторной отправкой.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="create-event-title"
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-xl border border-line bg-surface p-5 text-primary shadow-xl backdrop:bg-black/40"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="mb-4 flex items-start justify-between gap-2">
        <h2 id="create-event-title" className="text-xl font-semibold">
          Создать ивент
        </h2>
        <button
          type="button"
          aria-label="Закрыть окно"
          disabled={busy}
          onClick={onClose}
          className="-mr-2 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xl leading-none text-secondary hover:bg-surface-muted hover:text-primary"
        >
          ×
        </button>
      </div>
      {loading && <p>Загрузка справочников…</p>}
      <form onSubmit={submit} className="flex flex-col gap-4">
        <fieldset disabled={busy || loading} className="flex min-w-0 flex-col gap-4">
          <Field label="Название">
            <Input name="name" required maxLength={120} />
          </Field>
          <Field label="Тип ивента">
            <Select name="eventTypeId" required defaultValue="">
              <option value="" disabled>
                Выберите тип
              </option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Режим">
            <Select name="mode">
              <option value="PVE">PvE</option>
              <option value="PVP">PvP</option>
            </Select>
          </Field>
          <Field label="Начало">
            <Input
              type="datetime-local"
              required
              value={start}
              onChange={(e) => {
                setStart(e.target.value);
                if (!until) setUntil(e.target.value.slice(0, 10));
              }}
            />
          </Field>
          <Muted>Время в вашей таймзоне: {Intl.DateTimeFormat().resolvedOptions().timeZone}.</Muted>
          <Field label="Длительность, минут">
            <Input
              type="number"
              required
              min="1"
              step="1"
              value={duration}
              onChange={(e) => setDuration(e.target.value)}
            />
          </Field>
          <Field label="Плата ДКП">
            <Input name="dkpReward" type="number" required min="1" step="1" />
          </Field>
          <Field label="Рейд-лид">
            <Select name="raidLeadId" required defaultValue="">
              <option value="" disabled>
                Выберите участника
              </option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.nickname}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Место сбора">
            <Input name="place" maxLength={200} />
          </Field>
          <Field label="Заметки">
            <Input name="notes" maxLength={2000} />
          </Field>
          <Field label="Повторять">
            <Select value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
              <option value="NONE">Нет</option>
              <option value="DAILY">Ежедневно</option>
              <option value="WEEKLY">Еженедельно</option>
            </Select>
          </Field>
          {repeating && (
            <>
              <Field label="Дата окончания серии">
                <Input
                  type="date"
                  required
                  min={start.slice(0, 10)}
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                />
              </Field>
              {repeat === 'WEEKLY' && (
                <fieldset>
                  <legend className="mb-2 text-sm">Дни недели</legend>
                  <div className="flex flex-wrap gap-3">
                    {[1, 2, 3, 4, 5, 6, 0].map((day) => (
                      <label key={day} className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={weekdays.includes(day) || day === startsAt.getDay()}
                          disabled={day === startsAt.getDay()}
                          onChange={(e) =>
                            setWeekdays(
                              e.target.checked
                                ? [...weekdays, day]
                                : weekdays.filter((value) => value !== day),
                            )
                          }
                        />
                        {DAYS[day]}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
              <Muted>
                День первого ивента включён. Повторы сохраняют время UTC; при переходе на летнее
                время местное время может измениться.
              </Muted>
              {previewError && <ErrorText>{previewError}</ErrorText>}
              {slots.length > 0 && (
                <details>
                  <summary>Будет создано ивентов: {slots.length}</summary>
                  <ul className="mt-2 max-h-40 overflow-y-auto text-sm">
                    {slots.map((slot) => (
                      <li key={slot.startsAt.toISOString()}>
                        {slot.startsAt.toLocaleString('ru-RU')}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </fieldset>
        {!loading && (!types.length || !members.length) && (
          <Muted>Для создания нужны тип ивента и хотя бы один участник гильдии.</Muted>
        )}
        {error && (
          <div role="alert">
            <ErrorText>{error}</ErrorText>
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            variant="primary"
            disabled={busy || loading || !types.length || !members.length || !!previewError}
          >
            {busy ? 'Сохранение…' : 'Принять'}
          </Button>
          <Button type="button" disabled={busy} onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </form>
    </dialog>
  );
}

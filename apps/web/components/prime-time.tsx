'use client';

import { useState, type FormEvent } from 'react';
import { primeTimeSlotSchema, timeZoneSchema, type PlayerProfile, type PrimeTimeSlot } from '@dkp/shared';
import { api } from '../lib/api';
import { Button, Card, ErrorText, Field, Input, SectionTitle, Select, Stack } from './ui';

const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];
const format = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const parse = (value: string) => /^\d\d:\d\d$/.test(value) ? Number(value.slice(0, 2)) * 60 + Number(value.slice(3)) : NaN;

export function PrimeTime({ profile, editable }: { profile: PlayerProfile; editable: boolean }) {
  const [slots, setSlots] = useState<PrimeTimeSlot[]>(profile.primeTime ?? []);
  const [zone, setZone] = useState(profile.timeZone ?? 'Europe/Moscow');
  const [weekday, setWeekday] = useState(0);
  const [from, setFrom] = useState('19:00');
  const [to, setTo] = useState('23:00');
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  function add() {
    const candidate = primeTimeSlotSchema.safeParse({ weekday, fromMinute: parse(from), toMinute: parse(to) });
    if (!candidate.success || !/^([01]\d|2[0-3]):[0-5]\d$/.test(from) || !/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(to)) {
      setError('Укажите начало и конец в пределах суток, например 19:00–23:00 или 00:00–24:00');
      return;
    }
    setSlots([...slots, candidate.data]);
    setError('');
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!timeZoneSchema.safeParse(zone).success || comment.trim().length < 3) {
      setError('Укажите таймзону IANA и комментарий от 3 символов');
      return;
    }
    setBusy(true); setError(''); setMessage('');
    try {
      await api(`/profiles/${encodeURIComponent(profile.id)}`, { method: 'PATCH', body: JSON.stringify({ timeZone: zone, primeTime: slots, comment }) });
      setComment(''); setMessage('Прайм-тайм сохранён');
    } catch { setError('Не удалось сохранить прайм-тайм'); }
    finally { setBusy(false); }
  }
  return <Card><SectionTitle>Прайм-тайм</SectionTitle>
    <p>Таймзона: {editable ? zone : profile.timeZone}</p>
    {slots.length === 0 ? <p>Не указан</p> : <ul>{slots.map((slot, index) => <li key={index}>
      {days[slot.weekday]}: {format(slot.fromMinute)}–{format(slot.toMinute)}{' '}
      {editable && <Button type="button" onClick={() => setSlots(slots.filter((_, i) => i !== index))}>Удалить</Button>}
    </li>)}</ul>}
    {editable && <form onSubmit={save}><Stack>
      <Field label="Таймзона (IANA)"><Input value={zone} onChange={(event) => setZone(event.target.value)} /></Field>
      <Field label="День"><Select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>{days.map((day, index) => <option key={day} value={index}>{day}</option>)}</Select></Field>
      <Field label="Начало"><Input value={from} onChange={(event) => setFrom(event.target.value)} placeholder="00:00" /></Field>
      <Field label="Конец"><Input value={to} onChange={(event) => setTo(event.target.value)} placeholder="24:00" /></Field>
      <Button type="button" onClick={add}>Добавить интервал</Button>
      <Field label="Комментарий к прайм-тайму"><Input value={comment} onChange={(event) => setComment(event.target.value)} minLength={3} maxLength={500} required /></Field>
      <Button type="submit" variant="primary" disabled={busy}>Сохранить прайм-тайм</Button>
    </Stack></form>}
    {error && <ErrorText>{error}</ErrorText>}{message && <p role="status">{message}</p>}
  </Card>;
}

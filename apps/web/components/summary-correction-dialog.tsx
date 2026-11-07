'use client';
import { useState } from 'react';
import {
  ATTENDANCE_STATUSES,
  isAcceptedCheckIn,
  summaryActionSchema,
  type EventSummaryRow,
  type SummaryAction,
} from '@dkp/shared';
import { Button, ErrorText, Field, Input, Modal, Notice, Select, Stack } from './ui';
export const ATTENDANCE_LABELS: Record<string, string> = {
  PRESENT: 'Участвовал',
  LATE: 'Опоздал',
  LEFT_EARLY: 'Ушёл раньше',
  NO_SHOW: 'Отсутствовал',
  EXCUSED_ABSENCE: 'Отсутствовал по ув. причине',
};
export function SummaryCorrectionDialog({
  row,
  kind,
  onClose,
  onAdd,
}: {
  row: EventSummaryRow;
  kind: SummaryAction['kind'];
  onClose: () => void;
  onAdd: (action: SummaryAction) => string | null;
}) {
  const phases = (['START', 'END'] as const).filter(
    (phase) => !isAcceptedCheckIn(phase === 'START' ? row.checkinStart : row.checkinEnd),
  );
  const [phase, setPhase] = useState<'START' | 'END'>(phases[0] ?? 'START');
  const [comment, setComment] = useState('');
  const [amount, setAmount] = useState('');
  const [status, setStatus] = useState('PRESENT');
  const [error, setError] = useState('');
  const title = {
    CHECKIN: 'Добавить код',
    EXCUSE: 'Уважительная причина',
    DKP: 'Корректировка ДКП',
    ATTENDANCE: 'Ручной статус',
  }[kind];
  return (
    <Modal title={`${title}: ${row.memberName}`} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const common = { kind, memberId: row.memberId };
          const raw =
            kind === 'CHECKIN'
              ? { ...common, phase, comment }
              : kind === 'EXCUSE'
                ? { ...common, reason: comment }
                : kind === 'DKP'
                  ? { ...common, amount: amount.trim() ? Number(amount) : 0, comment }
                  : { ...common, status, comment };
          const parsed = summaryActionSchema.safeParse(raw);
          if (!parsed.success) {
            setError(
              kind === 'DKP'
                ? 'Укажите ненулевое целое число и обоснование от 3 до 500 символов.'
                : 'Укажите причину или комментарий от 3 до 500 символов.',
            );
            return;
          }
          const failure = onAdd(parsed.data);
          if (failure) setError(failure);
          else onClose();
        }}
      >
        <Stack>
          <Notice>
            Изменение попадёт в черновик. Оно сохранится после нажатия «Подвести итоги».
          </Notice>
          {kind === 'CHECKIN' && (
            <Field label="Код">
              <Select value={phase} onChange={(e) => setPhase(e.target.value as 'START' | 'END')}>
                {phases.map((p) => (
                  <option key={p} value={p}>
                    {p === 'START' ? 'Стартовый' : 'Финальный'}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {kind === 'DKP' && (
            <Field label="ДКП">
              <Input
                type="number"
                step="1"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </Field>
          )}
          {kind === 'ATTENDANCE' && (
            <Field label="Статус">
              <Select value={status} onChange={(e) => setStatus(e.target.value)}>
                {ATTENDANCE_STATUSES.filter((s) => s !== 'EXCUSED_ABSENCE').map((s) => (
                  <option key={s} value={s}>
                    {ATTENDANCE_LABELS[s]}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={kind === 'EXCUSE' ? 'Причина' : 'Обоснование'}>
            <Input
              required
              minLength={3}
              maxLength={500}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
            />
          </Field>
          {kind === 'EXCUSE' && (
            <Notice>
              Отсутствие оформляется на этот ивент. Уже полученные очки за коды сохраняются.
            </Notice>
          )}
          {error && <ErrorText>{error}</ErrorText>}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={onClose}>
              Отмена
            </Button>
            <Button type="submit" variant="primary">
              В черновик
            </Button>
          </div>
        </Stack>
      </form>
    </Modal>
  );
}

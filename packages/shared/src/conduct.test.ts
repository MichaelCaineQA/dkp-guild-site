import { describe, expect, it } from 'vitest';
import {
  buildEventSummary,
  manualCheckInSchema,
  manualDkpSchema,
  setAttendanceSchema,
} from './conduct';

describe('setAttendanceSchema', () => {
  it('принимает отметку с комментарием', () => {
    const parsed = setAttendanceSchema.parse({
      memberId: 'm-1',
      status: 'LATE',
      comment: 'Задержался на работе',
    });
    expect(parsed.status).toBe('LATE');
  });

  it('EXCUSED_ABSENCE вручную ставить нельзя — только автоматически', () => {
    expect(() =>
      setAttendanceSchema.parse({
        memberId: 'm-1',
        status: 'EXCUSED_ABSENCE',
        comment: 'Отсутствовал',
      }),
    ).toThrow();
  });

  it('без комментария — ошибка (правило аудита)', () => {
    expect(() =>
      setAttendanceSchema.parse({ memberId: 'm-1', status: 'PRESENT', comment: 'ок' }),
    ).toThrow();
  });
});

describe('manualCheckInSchema', () => {
  it('фаза START или END с комментарием', () => {
    expect(
      manualCheckInSchema.parse({ memberId: 'm-1', phase: 'START', comment: 'Ошибся кодом' }).phase,
    ).toBe('START');
    expect(() =>
      manualCheckInSchema.parse({ memberId: 'm-1', phase: 'MIDDLE', comment: 'Нет такой фазы' }),
    ).toThrow();
  });
});

describe('manualDkpSchema', () => {
  it('ручное начисление и корректировка с комментарием', () => {
    expect(
      manualDkpSchema.parse({ memberId: 'm-1', type: 'MANUAL_EARN', amount: 5, comment: 'Помог с сбором' }),
    ).toMatchObject({ type: 'MANUAL_EARN', amount: 5 });
    expect(
      manualDkpSchema.parse({ memberId: 'm-1', type: 'ADJUSTMENT', amount: -3, comment: 'Ошибка прошлого начисления' }),
    ).toMatchObject({ type: 'ADJUSTMENT', amount: -3 });
  });

  it('чек-ин и аукцион вручную не создаются (только системы)', () => {
    expect(() =>
      manualDkpSchema.parse({ memberId: 'm-1', type: 'CHECKIN_EARN', amount: 5, comment: 'Обход' }),
    ).toThrow();
    expect(() =>
      manualDkpSchema.parse({ memberId: 'm-1', type: 'AUCTION_SPEND', amount: -5, comment: 'Обход' }),
    ).toThrow();
  });

  it('нулевая сумма — ошибка', () => {
    expect(() =>
      manualDkpSchema.parse({ memberId: 'm-1', type: 'MANUAL_EARN', amount: 0, comment: 'Ноль очков' }),
    ).toThrow();
  });
});

describe('buildEventSummary', () => {
  const members = [
    { id: 'm-1', nickname: 'Активный' },
    { id: 'm-2', nickname: 'Опоздавший' },
    { id: 'm-3', nickname: 'Пропущенный' },
  ];

  it('сводит посещения и журнал ДКП по ивенту', () => {
    const summary = buildEventSummary(
      members,
      [
        { memberId: 'm-1', status: 'PRESENT', checkinStart: 'PASSED', checkinEnd: 'PASSED' },
        { memberId: 'm-2', status: 'LATE', checkinStart: 'MANUAL', checkinEnd: 'PENDING' },
      ],
      [
        { memberId: 'm-1', amount: 5, type: 'CHECKIN_EARN', eventId: 'e-1' },
        { memberId: 'm-1', amount: 5, type: 'CHECKIN_EARN', eventId: 'e-1' },
        { memberId: 'm-2', amount: 5, type: 'MANUAL_EARN', eventId: 'e-1' },
        { memberId: 'm-3', amount: 7, type: 'MANUAL_EARN', eventId: 'e-2' }, // чужой ивент
      ],
      'e-1',
    );

    expect(summary).toHaveLength(3);
    expect(summary[0]).toMatchObject({
      memberName: 'Активный',
      attendanceStatus: 'PRESENT',
      checkinStart: 'PASSED',
      dkpEarned: 10,
    });
    expect(summary[1]).toMatchObject({ memberName: 'Опоздавший', checkinStart: 'MANUAL', dkpEarned: 5 });
    expect(summary[2]).toMatchObject({ memberName: 'Пропущенный', attendanceStatus: null, dkpEarned: 0 });
  });

  it('без посещений все PENDING и ноль ДКП', () => {
    const summary = buildEventSummary(members, [], [], 'e-1');
    expect(summary.every((row) => row.checkinStart === 'PENDING' && row.dkpEarned === 0)).toBe(true);
  });
});

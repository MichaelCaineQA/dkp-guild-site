import { describe, it, expect } from 'vitest';
import { participationActions, participationInputSchema } from './participation';
describe('Моё участие', () => {
  const startsAt = new Date('2026-11-09T17:00:00Z');
  const event = { startsAt, status: 'PLANNED' };
  it('точно на дедлайне можно отказаться, позднее — только отменить отсутствие до старта', () => {
    expect(participationActions(event, new Date(+startsAt - 180000), 180)).toMatchObject({
      canDecline: true,
      canAttend: true,
    });
    expect(participationActions(event, new Date(+startsAt - 179999), 180)).toMatchObject({
      canDecline: false,
      canAttend: true,
    });
    expect(participationActions(event, startsAt, 180)).toMatchObject({
      canDecline: false,
      canAttend: false,
    });
  });
  it('использует настройку, завершённые/отменённые/идущие закрыты для изменения', () => {
    expect(participationActions(event, new Date(+startsAt - 300000), 600).canDecline).toBe(false);
    for (const status of ['RUNNING', 'FINISHED', 'CANCELLED'])
      expect(participationActions({ ...event, status }, new Date(0), 180)).toMatchObject({
        canDecline: false,
        canAttend: false,
      });
  });
  it('причина необязательна и ограничена, нельзя подставить другого участника', () => {
    expect(participationInputSchema.parse({ attending: false }).reason).toBe('');
    expect(participationInputSchema.parse({ attending: false, reason: ' ок ' }).reason).toBe('ок');
    expect(
      participationInputSchema.safeParse({ attending: false, reason: 'x'.repeat(501) }).success,
    ).toBe(false);
    expect(
      participationInputSchema.safeParse({ attending: false, memberId: 'other' }).success,
    ).toBe(false);
  });
});

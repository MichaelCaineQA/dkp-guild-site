import { describe, expect, it } from 'vitest';
import { isGearScoreStale } from './profile';

const now = new Date('2026-11-15T12:00:00Z');

describe('свежесть GS', () => {
  it('не считает запись ровно на пороге устаревшей', () => {
    expect(
      isGearScoreStale(
        [{ createdAt: new Date('2026-11-01T12:00:00Z'), screenshotIds: ['s'] }],
        14,
        now,
      ),
    ).toBe(false);
  });
  it('считает запись старше порога устаревшей', () => {
    expect(
      isGearScoreStale(
        [{ createdAt: new Date('2026-11-01T11:59:00Z'), screenshotIds: ['s'] }],
        14,
        now,
      ),
    ).toBe(true);
  });
  it('игнорирует более новую запись без скриншота', () => {
    expect(
      isGearScoreStale(
        [
          { createdAt: new Date('2026-10-01T12:00:00Z'), screenshotIds: ['s'] },
          { createdAt: now, screenshotIds: [] },
        ],
        14,
        now,
      ),
    ).toBe(true);
  });
  it('не показывает устаревание без подтверждённой записи', () => {
    expect(
      isGearScoreStale(
        [{ createdAt: new Date('2026-10-01T12:00:00Z'), screenshotIds: [] }],
        14,
        now,
      ),
    ).toBe(false);
  });
});

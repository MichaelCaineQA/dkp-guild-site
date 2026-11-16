import { describe, expect, it } from 'vitest';
import { memberPackAt, packKpAt } from './index';

const first = new Date('2026-01-02T00:00:00Z');
const second = new Date('2026-01-03T00:00:00Z');
const transfers = [
  { memberId: 'm', previousPackId: 'a', packId: 'b', changedAt: first },
  { memberId: 'm', previousPackId: 'b', packId: null, changedAt: second },
];

describe('membership at a date', () => {
  it('uses current membership when no transfers were recorded', () => {
    expect(memberPackAt('a', [], new Date('2020-01-01Z'))).toBe('a');
  });
  it('uses the previous pack before the first transfer', () => {
    expect(memberPackAt(null, transfers, new Date('2026-01-01Z'))).toBe('a');
  });
  it('applies a transfer at its exact timestamp regardless of input order', () => {
    expect(memberPackAt(null, [...transfers].reverse(), first)).toBe('b');
  });
  it('preserves removal from a pack', () => {
    expect(memberPackAt(null, transfers, second)).toBeNull();
  });
  it('resolves a pack’s former KP before its transfer', () => {
    expect(
      packKpAt(
        'new',
        [{ packId: 'p', previousKpId: 'old', kpId: 'new', changedAt: first }],
        new Date('2026-01-01Z'),
      ),
    ).toBe('old');
  });
  it('resolves a pack’s new KP at its transfer', () => {
    expect(
      packKpAt('new', [{ packId: 'p', previousKpId: 'old', kpId: 'new', changedAt: first }], first),
    ).toBe('new');
  });
});

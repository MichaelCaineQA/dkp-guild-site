import { describe, expect, it } from 'vitest';
import { auditQuerySchema } from './audit';
describe('Фильтры аудита', () => {
  it('сущность, автор и период независимы и сочетаются', () => {
    for (const query of [
      { entityType: 'Event' },
      { actorMemberId: 'm' },
      { system: 'true' },
      { from: '2026-11-01' },
      { to: '2026-11-08' },
      { entityType: 'Pack', actorMemberId: 'm', from: '2026-11-01', to: '2026-11-08' },
    ])
      expect(auditQuerySchema.safeParse(query).success).toBe(true);
  });
  it('неоднозначный автор и неправильные даты отклоняются, false не означает true', () => {
    expect(auditQuerySchema.parse({ system: 'false' }).system).toBe(false);
    expect(auditQuerySchema.safeParse({ system: 'true', actorMemberId: 'm' }).success).toBe(false);
    expect(auditQuerySchema.safeParse({ from: '2026-11-08', to: '2026-11-01' }).success).toBe(
      false,
    );
  });
});

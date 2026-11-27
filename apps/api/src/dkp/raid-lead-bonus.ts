import { raidLeadBonusAmount } from '@dkp/shared';

export interface RaidLeadBonusLedger {
  findMany(args: {
    where: {
      eventId: string;
      memberId: string;
      type: { in: Array<'CHECKIN_EARN' | 'RAID_LEAD_BONUS'> };
    };
  }): Promise<Array<{ amount: number; type: string }>>;
  create(args: {
    data: {
      memberId: string;
      eventId: string;
      type: 'RAID_LEAD_BONUS';
      amount: number;
      requestId: string;
      createdById: null;
      comment: string;
    };
  }): Promise<{ id: string }>;
}

/** Вызывается в транзакции завершения ивента или начисления ДКП за отметку. */
export async function awardRaidLeadBonus(
  ledger: RaidLeadBonusLedger,
  eventId: string,
  memberId: string,
): Promise<void> {
  const entries = await ledger.findMany({
    where: { eventId, memberId, type: { in: ['CHECKIN_EARN', 'RAID_LEAD_BONUS'] } },
  });
  let checkInDkp = 0;
  let awarded = 0;
  for (const entry of entries) {
    if (entry.type === 'CHECKIN_EARN') checkInDkp += entry.amount;
    if (entry.type === 'RAID_LEAD_BONUS') awarded += entry.amount;
  }

  const amount = raidLeadBonusAmount(checkInDkp) - awarded;
  if (amount <= 0) return;
  await ledger.create({
    data: {
      memberId,
      eventId,
      type: 'RAID_LEAD_BONUS',
      amount,
      requestId: `raid-lead-bonus:${eventId}:${checkInDkp}`,
      createdById: null,
      comment: 'За ведение рейда',
    },
  });
}

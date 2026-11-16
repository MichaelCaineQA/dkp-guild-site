import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { addGearScoreSchema, canEditOwnProfile, type SessionUser } from '@dkp/shared';
import type { PrismaClient } from '@prisma/client';

export type GearScoreDb = Pick<PrismaClient, '$transaction'>;
@Injectable()
export class GearScoreService {
  constructor(private readonly db: GearScoreDb) {}

  async add(id: string, body: unknown, actor: SessionUser) {
    if (!canEditOwnProfile(actor, id))
      throw new ForbiddenException('Можно обновлять только свой GS');
    const input = addGearScoreSchema.parse(body);
    await this.db.$transaction(async (tx) => {
      const member = await tx.member.findUnique({ where: { id } });
      if (!member || member.userId !== actor.userId || member.blockedAt)
        throw new ForbiddenException('Можно обновлять только свой GS');
      const count = await tx.screenshot.count({
        where: { id: { in: input.screenshotIds }, userId: actor.userId },
      });
      if (count !== input.screenshotIds.length)
        throw new BadRequestException('Загрузите собственные скриншоты');
      await tx.gearScoreRecord.create({
        data: { memberId: id, value: input.gearScore, screenshotIds: input.screenshotIds },
      });
      // Значение GS и id файлов приватны: аудит фиксирует поля, но не раскрывает их.
      await tx.auditLog.create({
        data: {
          actorMemberId: id,
          action: 'GEAR_SCORE_UPDATE',
          entityType: 'Member',
          entityId: id,
          comment: `Обновлены GS и подтверждающие скриншоты. ${input.comment}`,
        },
      });
    });
    return { ok: true };
  }
}

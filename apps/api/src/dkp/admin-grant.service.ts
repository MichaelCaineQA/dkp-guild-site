import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { adminDkpGrantSchema } from '@dkp/shared';
import { serializable } from '../prisma/serializable';

@Injectable()
export class AdminGrantService {
  constructor(private readonly db: PrismaClient) {}

  async grant(body: unknown, isAdmin: boolean) {
    if (!isAdmin) throw new ForbiddenException('Начисление доступно только Админу');
    const parsed = adminDkpGrantSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Проверьте получателя, сумму и комментарий');
    const input = parsed.data;
    return serializable(
      this.db,
      async (tx) => {
        const existing = await tx.dkpEntry.findUnique({ where: { requestId: input.requestId } });
        if (existing) {
          if (
            existing.type !== 'MANUAL_EARN' ||
            existing.memberId !== input.memberId ||
            existing.amount !== input.amount ||
            existing.comment !== input.comment ||
            existing.eventId !== null
          )
            throw new ConflictException('Идентификатор уже использован для другой операции');
          return { id: existing.id, repeated: true };
        }
        const member = await tx.member.findUnique({
          where: { id: input.memberId },
          select: { id: true, nickname: true },
        });
        if (!member) throw new NotFoundException('Участник не найден');
        const entry = await tx.dkpEntry.create({
          data: {
            requestId: input.requestId,
            memberId: member.id,
            type: 'MANUAL_EARN',
            amount: input.amount,
            comment: input.comment,
          },
        });
        await tx.auditLog.create({
          data: {
            actorMemberId: null,
            actorIsAdmin: true,
            action: 'MANUAL_DKP',
            entityType: 'DkpEntry',
            entityId: entry.id,
            comment: `Админ начислил ${input.amount} ДКП участнику ${member.nickname}. ${input.comment}`,
          },
        });
        return { id: entry.id, repeated: false };
      },
      true,
    );
  }
}

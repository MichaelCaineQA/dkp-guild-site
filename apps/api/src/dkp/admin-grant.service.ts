import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { adminDkpGrantSchema, can, type PermissionActor } from '@dkp/shared';
import { serializable } from '../prisma/serializable';

/** Актор начисления — пользователь сессии: права читаются из него, не из строки члена. */
export type DkpGrantActor = Pick<PermissionActor, 'rank' | 'memberId' | 'isAdmin'>;

/**
 * Ручное начисление ДКП вне ивента (план 2.2, решение 22): Глава и Админ,
 * включая резервного админа без Member. Путь и схема остались «admin-grants» —
 * до решения 22 начислял только Админ; переименование ломало бы контракт API.
 */
@Injectable()
export class AdminGrantService {
  constructor(private readonly db: PrismaClient) {}

  async grant(body: unknown, actor: DkpGrantActor) {
    // Право проверяется и здесь: защита не зависит от guard'а контроллера.
    if (!can(actor, 'dkp.grant'))
      throw new ForbiddenException('Начисление доступно Главе и Админу');
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
            // Автор записи — как у начислений в ивенте; у резервного админа Member нет.
            createdById: actor.memberId ?? null,
          },
        });
        const author = actor.isAdmin || actor.rank === 'ADMIN' ? 'Админ' : 'Глава';
        await tx.auditLog.create({
          data: {
            actorMemberId: actor.memberId ?? null,
            actorIsAdmin: !!actor.isAdmin,
            action: 'MANUAL_DKP',
            entityType: 'DkpEntry',
            entityId: entry.id,
            comment: `${author} начислил ${input.amount} ДКП участнику ${member.nickname}. ${input.comment}`,
          },
        });
        return { id: entry.id, repeated: false };
      },
      true,
    );
  }
}

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createLinkRequestSchema } from '@dkp/shared';
import { Prisma, type PrismaClient } from '@prisma/client';
export type LinkRequestDb = Pick<
  PrismaClient,
  'user' | 'member' | 'memberLinkRequest' | 'screenshot' | '$transaction'
>;
const select = {
  id: true,
  nickname: true,
  combatRole: true,
  weapons: true,
  gearScore: true,
  screenshotIds: true,
  createdAt: true,
} as const;
const orderBy = [{ createdAt: 'desc' }, { id: 'desc' }] as const;
@Injectable()
export class LinkRequestService {
  constructor(private readonly db: LinkRequestDb) {}
  private async transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034' &&
          attempt < 3
        )
          continue;
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          ['P2002', 'P2034'].includes(error.code)
        )
          throw new ConflictException('Анкета изменилась или ник уже занят. Обновите страницу.');
        throw error;
      }
    }
  }
  async mine(userId: string) {
    return this.db.memberLinkRequest.findFirst({
      where: { userId, status: 'PENDING', user: { member: { is: null } } },
      orderBy: [...orderBy],
      select,
    });
  }
  async create(userId: string, body: unknown) {
    const parsed = createLinkRequestSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        'Укажите ник, роль, два разных оружия, положительный целый GS и скриншот',
      );
    const input = parsed.data;
    return this.transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: userId }, include: { member: true } });
      if (!user || user.member || !user.discordId)
        throw new UnauthorizedException('Анкета доступна непринятому Discord-аккаунту');
      const files = await tx.screenshot.count({
        where: { id: { in: input.screenshotIds }, userId },
      });
      if (files !== input.screenshotIds.length)
        throw new BadRequestException('Загрузите собственные скриншоты');
      const occupied = await tx.member.findUnique({ where: { nickname: input.nickname } });
      if (occupied?.userId) throw new ConflictException('Этот ник уже занят');
      const current = await tx.memberLinkRequest.findFirst({
        where: { userId, status: 'PENDING' },
        orderBy: [...orderBy],
      });
      if (current) await tx.memberLinkRequest.update({ where: { id: current.id }, data: input });
      else await tx.memberLinkRequest.create({ data: { userId, ...input } });
      await tx.auditLog.create({
        data: {
          action: current ? 'ONBOARDING_UPDATE' : 'ONBOARDING_SUBMIT',
          entityType: 'User',
          entityId: userId,
          comment: current
            ? 'Обновлена анкета вступления: ник, роль, оружия и подтверждение GS'
            : 'Подана анкета вступления',
        },
      });
      return { ok: true };
    });
  }
  async listPending() {
    return this.db.memberLinkRequest.findMany({
      where: { status: 'PENDING', user: { member: { is: null } } },
      orderBy: [...orderBy],
      distinct: ['userId'],
      select: { ...select, user: { select: { username: true } } },
    });
  }
  async getPending(id: string) {
    const request = await this.db.memberLinkRequest.findFirst({
      where: { id, status: 'PENDING', user: { member: { is: null } } },
      select: { ...select, user: { select: { username: true } } },
    });
    if (!request) throw new NotFoundException('Анкета не найдена');
    return request;
  }
  async approve(id: string, actorMemberId: string | null = null) {
    return this.transaction(async (tx) => {
      const request = await tx.memberLinkRequest.findUnique({ where: { id } });
      if (!request || request.status !== 'PENDING')
        throw new NotFoundException('Заявка не найдена или уже обработана');
      const latest = await tx.memberLinkRequest.findFirst({
        where: { userId: request.userId, status: 'PENDING' },
        orderBy: [...orderBy],
      });
      if (latest?.id !== id) throw new ConflictException('Откройте актуальную анкету игрока');
      const parsed = createLinkRequestSchema.safeParse(request);
      if (!parsed.success)
        throw new ConflictException(
          'Анкета неполная. Попросите игрока обновить её, добавив GS и скриншот.',
        );
      const input = parsed.data;
      const user = await tx.user.findUnique({
        where: { id: request.userId },
        include: { member: true },
      });
      if (!user || user.member || !user.discordId)
        throw new ConflictException('Аккаунт уже принят или недоступен');
      const files = await tx.screenshot.count({
        where: { id: { in: input.screenshotIds }, userId: request.userId },
      });
      if (files !== input.screenshotIds.length)
        throw new ConflictException('Скриншоты недоступны. Обновите анкету.');
      const existing = await tx.member.findUnique({ where: { nickname: request.nickname } });
      if (existing?.userId) throw new ConflictException('Этот ник уже занят другим аккаунтом');
      const data = {
        nickname: input.nickname,
        userId: request.userId,
        combatRole: input.combatRole,
        weapons: input.weapons,
      };
      const member = existing
        ? await tx.member.update({ where: { id: existing.id }, data })
        : await tx.member.create({ data });
      await tx.gearScoreRecord.create({
        data: { memberId: member.id, value: input.gearScore, screenshotIds: input.screenshotIds },
      });
      await tx.memberLinkRequest.update({
        where: { id },
        data: { status: 'APPROVED', resolvedAt: new Date(), resolvedById: actorMemberId },
      });
      await tx.auditLog.create({
        data: {
          actorMemberId,
          action: 'LINK_REQUEST_APPROVE',
          entityType: 'MemberLinkRequest',
          entityId: id,
          comment: 'Одобрено вступление в гильдию; анкета и подтверждение GS перенесены в профиль',
        },
      });
      return { ok: true };
    });
  }
}

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  orgCreateKpSchema,
  orgCreatePackSchema,
  orgMoveMemberSchema,
  orgMovePackSchema,
  orgLeaderSchema,
} from '@dkp/shared';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import type { SessionUser } from '../auth/session.types';

type Tx = Prisma.TransactionClient;

@Injectable()
export class OrgService {
  constructor(private readonly db: PrismaService) {}

  async roster(actor: SessionUser, kpId?: string, packId?: string) {
    const viewer = actor.memberId
      ? await this.db.member.findUnique({
          where: { id: actor.memberId },
          select: { rank: true, blockedAt: true },
        })
      : null;
    if (!actor.isAdmin && (!viewer || viewer.blockedAt))
      throw new ForbiddenException('Недостаточно прав');
    if (kpId && packId) throw new BadRequestException('Выберите КП или пак');
    const groups = await this.db.kP.findMany({
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        leaderId: true,
        packs: {
          orderBy: { name: 'asc' },
          select: { id: true, name: true, leaderId: true, kpId: true },
        },
      },
    });
    const members = await this.db.member.findMany({
      where: {
        blockedAt: null,
        ...(kpId ? { pack: { kpId } } : {}),
        ...(packId ? { packId } : {}),
      },
      orderBy: { nickname: 'asc' },
      select: {
        id: true,
        nickname: true,
        avatar: true,
        avatarColor: true,
        rank: true,
        combatRole: true,
        weapons: true,
        pack: {
          select: {
            id: true,
            name: true,
            leaderId: true,
            kp: { select: { id: true, name: true, leaderId: true } },
          },
        },
        gsRecords: {
          where: { NOT: { screenshotIds: { isEmpty: true } } },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { value: true, screenshotIds: true },
        },
      },
    });
    const privileged = actor.isAdmin || viewer?.rank === 'GUILD_LEADER';
    return {
      groups,
      members: members.map(({ gsRecords, pack, ...member }) => {
        const groupAccess =
          !!(kpId || packId) &&
          !!actor.memberId &&
          (pack?.kp.leaderId === actor.memberId || pack?.leaderId === actor.memberId);
        return {
          ...member,
          pack,
          ...(privileged || groupAccess
            ? {
                gearScore: gsRecords[0]?.value ?? null,
                screenshotIds: gsRecords[0]?.screenshotIds ?? [],
              }
            : {}),
        };
      }),
    };
  }

  private parse<T>(
    schema: { safeParse(value: unknown): { success: true; data: T } | { success: false } },
    body: unknown,
  ): T {
    const parsed = schema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Некорректные данные');
    return parsed.data;
  }

  private async authorize(tx: Tx, actor: SessionUser, kpId?: string) {
    if (actor.isAdmin) return;
    if (!actor.memberId) throw new ForbiddenException('Недостаточно прав');
    const member = await tx.member.findUnique({
      where: { id: actor.memberId },
      select: { rank: true, blockedAt: true },
    });
    if (member && !member.blockedAt && member.rank === 'GUILD_LEADER') return;
    if (
      member &&
      !member.blockedAt &&
      kpId &&
      (await tx.kP.findFirst({ where: { id: kpId, leaderId: actor.memberId } }))
    )
      return;
    throw new ForbiddenException('Недостаточно прав');
  }

  private async audit(
    tx: Tx,
    actor: SessionUser,
    action: string,
    entityType: string,
    entityId: string,
    comment: string,
  ) {
    await tx.auditLog.create({
      data: {
        actorMemberId: actor.memberId,
        actorIsAdmin: actor.isAdmin,
        action,
        entityType,
        entityId,
        comment,
      },
    });
  }

  private async transferMember(tx: Tx, memberId: string, packId: string, actor: SessionUser) {
    const member = await tx.member.findUnique({ where: { id: memberId }, include: { pack: true } });
    if (!member) throw new NotFoundException('Участник не найден');
    const pack = await tx.pack.findUnique({ where: { id: packId } });
    if (!pack) throw new NotFoundException('Пак не найден');
    if (member.packId === packId) throw new ConflictException('Участник уже в этом паке');
    if (member.packId) {
      await tx.pack.updateMany({
        where: { id: member.packId, leaderId: memberId },
        data: { leaderId: null },
      });
      await tx.kP.updateMany({
        where: { id: member.pack!.kpId, leaderId: memberId },
        data: { leaderId: null },
      });
    }
    const previous = await tx.memberPackHistory.findFirst({
      where: { memberId },
      orderBy: { changedAt: 'desc' },
    });
    const changedAt = new Date(Math.max(Date.now(), (previous?.changedAt.getTime() ?? 0) + 1));
    await tx.member.update({ where: { id: memberId }, data: { packId, packJoinedAt: changedAt } });
    await tx.memberPackHistory.create({
      data: { memberId, previousPackId: member.packId, packId, changedAt },
    });
    await this.audit(
      tx,
      actor,
      'MEMBER_PACK_TRANSFER',
      'Member',
      memberId,
      `Перенос из пака ${member.packId ?? 'без пака'} в пак ${packId}`,
    );
  }

  private async transferPack(tx: Tx, packId: string, kpId: string, actor: SessionUser) {
    const pack = await tx.pack.findUnique({
      where: { id: packId },
      include: { members: { select: { id: true } } },
    });
    if (!pack) throw new NotFoundException('Пак не найден');
    if (!(await tx.kP.findUnique({ where: { id: kpId } })))
      throw new NotFoundException('КП не найдена');
    if (pack.kpId === kpId) throw new ConflictException('Пак уже в этой КП');
    await tx.kP.updateMany({
      where: { id: pack.kpId, leaderId: { in: pack.members.map((m) => m.id) } },
      data: { leaderId: null },
    });
    const previous = await tx.packMembershipHistory.findFirst({
      where: { packId },
      orderBy: { changedAt: 'desc' },
    });
    const changedAt = new Date(Math.max(Date.now(), (previous?.changedAt.getTime() ?? 0) + 1));
    await tx.pack.update({ where: { id: packId }, data: { kpId } });
    await tx.packMembershipHistory.create({
      data: { packId, previousKpId: pack.kpId, kpId, changedAt },
    });
    await this.audit(
      tx,
      actor,
      'PACK_KP_TRANSFER',
      'Pack',
      packId,
      `Перенос из КП ${pack.kpId} в КП ${kpId}`,
    );
  }

  async createKp(body: unknown, actor: SessionUser) {
    const input = this.parse(orgCreateKpSchema, body);
    return serializable(
      this.db,
      async (tx) => {
        await this.authorize(tx, actor);
        const guild = await tx.guild.findFirst({ orderBy: { createdAt: 'asc' } });
        if (!guild) throw new NotFoundException('Гильдия не найдена');
        const kp = await tx.kP.create({ data: { name: input.name, guildId: guild.id } });
        for (const packId of input.packIds) await this.transferPack(tx, packId, kp.id, actor);
        await this.audit(tx, actor, 'KP_CREATE', 'KP', kp.id, `Создана КП «${kp.name}»`);
        return kp;
      },
      true,
    );
  }

  async createPack(body: unknown, actor: SessionUser) {
    const input = this.parse(orgCreatePackSchema, body);
    return serializable(
      this.db,
      async (tx) => {
        await this.authorize(tx, actor, input.kpId);
        if (!(await tx.kP.findUnique({ where: { id: input.kpId } })))
          throw new NotFoundException('КП не найдена');
        for (const memberId of input.memberIds) {
          const member = await tx.member.findUnique({
            where: { id: memberId },
            include: { pack: true },
          });
          if (!member || member.pack?.kpId !== input.kpId)
            throw new BadRequestException('Участник должен состоять в выбранной КП');
        }
        const pack = await tx.pack.create({ data: { name: input.name, kpId: input.kpId } });
        for (const memberId of input.memberIds)
          await this.transferMember(tx, memberId, pack.id, actor);
        await this.audit(
          tx,
          actor,
          'PACK_CREATE',
          'Pack',
          pack.id,
          `Создан пак «${pack.name}» в КП ${input.kpId}`,
        );
        return pack;
      },
      true,
    );
  }

  async moveMember(memberId: string, body: unknown, actor: SessionUser) {
    const input = this.parse(orgMoveMemberSchema, body);
    return serializable(
      this.db,
      async (tx) => {
        await this.authorize(tx, actor);
        await this.transferMember(tx, memberId, input.packId, actor);
        return { ok: true as const };
      },
      true,
    );
  }

  async movePack(packId: string, body: unknown, actor: SessionUser) {
    const input = this.parse(orgMovePackSchema, body);
    return serializable(
      this.db,
      async (tx) => {
        await this.authorize(tx, actor);
        await this.transferPack(tx, packId, input.kpId, actor);
        return { ok: true as const };
      },
      true,
    );
  }

  async setKpLeader(kpId: string, body: unknown, actor: SessionUser) {
    const input = this.parse(orgLeaderSchema, body);
    return serializable(
      this.db,
      async (tx) => {
        await this.authorize(tx, actor);
        const kp = await tx.kP.findUnique({ where: { id: kpId } });
        if (!kp) throw new NotFoundException('КП не найдена');
        if (
          input.memberId &&
          !(await tx.member.findFirst({
            where: { id: input.memberId, pack: { kpId }, blockedAt: null },
          }))
        )
          throw new BadRequestException('Кандидат не состоит в КП');
        if (kp.leaderId === input.memberId) throw new ConflictException('Лидер не изменился');
        await tx.kP.update({ where: { id: kpId }, data: { leaderId: input.memberId } });
        await this.audit(
          tx,
          actor,
          'KP_LEADER_CHANGE',
          'KP',
          kpId,
          `Лидер КП: ${kp.leaderId ?? 'не назначен'} → ${input.memberId ?? 'не назначен'}`,
        );
        return { ok: true as const };
      },
      true,
    );
  }

  async setPackLeader(packId: string, body: unknown, actor: SessionUser) {
    const input = this.parse(orgLeaderSchema, body);
    return serializable(
      this.db,
      async (tx) => {
        const pack = await tx.pack.findUnique({ where: { id: packId } });
        if (!pack) throw new NotFoundException('Пак не найден');
        await this.authorize(tx, actor, pack.kpId);
        if (
          input.memberId &&
          !(await tx.member.findFirst({ where: { id: input.memberId, packId, blockedAt: null } }))
        )
          throw new BadRequestException('Кандидат не состоит в паке');
        if (pack.leaderId === input.memberId) throw new ConflictException('Лидер не изменился');
        await tx.pack.update({ where: { id: packId }, data: { leaderId: input.memberId } });
        await this.audit(
          tx,
          actor,
          'PACK_LEADER_CHANGE',
          'Pack',
          packId,
          `Лидер пака: ${pack.leaderId ?? 'не назначен'} → ${input.memberId ?? 'не назначен'}`,
        );
        return { ok: true as const };
      },
      true,
    );
  }
}

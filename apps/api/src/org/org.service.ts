import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  can,
  canManageKp,
  canMoveOrgMember,
  orgCreateKpSchema,
  orgCreatePackSchema,
  orgEditKpSchema,
  orgMoveMemberSchema,
  orgMovePackSchema,
  orgLeaderSchema,
  isGearScoreStale,
} from '@dkp/shared';
import { gearScoreStaleDays } from '../settings/gear-score-settings';
import { PrismaService } from '../prisma/prisma.service';
import { serializable } from '../prisma/serializable';
import type { SessionUser } from '../auth/session.types';

type Tx = Prisma.TransactionClient;
type Kp = { id: string; name: string; leaderId: string | null };
const kpFields = { id: true, name: true, leaderId: true } as const;

function kpMembership(kpId: string): Prisma.MemberWhereInput {
  return { OR: [{ directKpId: kpId }, { pack: { kpId } }] };
}

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
        ...(kpId ? kpMembership(kpId) : {}),
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
        directKp: { select: kpFields },
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
          select: { value: true, screenshotIds: true, createdAt: true },
        },
      },
    });
    const privileged = actor.isAdmin || viewer?.rank === 'GUILD_LEADER' || viewer?.rank === 'ADMIN';
    const staleDays = await gearScoreStaleDays(this.db);
    const now = new Date();
    return {
      groups,
      members: members.map(({ gsRecords, pack, directKp, ...member }) => {
        const kp = pack?.kp ?? directKp;
        const groupAccess =
          !!(kpId || packId) &&
          !!actor.memberId &&
          (kp?.leaderId === actor.memberId || (!!packId && pack?.leaderId === actor.memberId));
        return {
          ...member,
          kp,
          pack,
          ...(privileged || groupAccess
            ? {
                gearScore: gsRecords[0]?.value ?? null,
                gearScoreStale: isGearScoreStale(gsRecords, staleDays, now),
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

  private async activeActor(tx: Tx, actor: SessionUser) {
    if (actor.isAdmin) return actor;
    if (!actor.memberId) throw new ForbiddenException('Недостаточно прав');
    const member = await tx.member.findUnique({
      where: { id: actor.memberId },
      select: { rank: true, blockedAt: true },
    });
    if (!member || member.blockedAt) throw new ForbiddenException('Недостаточно прав');
    return { ...actor, rank: member.rank };
  }

  private requirePermission(allowed: boolean) {
    if (!allowed) throw new ForbiddenException('Недостаточно прав');
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

  /** Ник участника для аудита: ID остаются в entityType/entityId, в комментарии — имена. */
  private async leaderName(tx: Tx, memberId: string | null): Promise<string> {
    if (!memberId) return 'не назначен';
    const member = await tx.member.findUnique({
      where: { id: memberId },
      select: { nickname: true },
    });
    return member?.nickname ?? 'участник недоступен';
  }

  private async transferMember(
    tx: Tx,
    memberId: string,
    kp: Kp,
    pack: { id: string; name: string } | null,
    actor: SessionUser,
    creatingPack = false,
  ) {
    const member = await tx.member.findUnique({
      where: { id: memberId },
      include: { pack: true, directKp: true },
    });
    if (!member || member.blockedAt) throw new NotFoundException('Участник не найден');
    const previousKpId = member.pack?.kpId ?? member.directKpId;
    this.requirePermission(
      canMoveOrgMember(actor, kp, { kpId: previousKpId, packId: member.packId }),
    );
    if (creatingPack && previousKpId && previousKpId !== kp.id)
      throw new BadRequestException('Участник должен состоять в выбранной КП или быть без группы');
    const packId = pack?.id ?? null;
    const directKpId = pack ? null : kp.id;
    if (member.packId === packId && member.directKpId === directKpId)
      throw new ConflictException('Участник уже в выбранном составе');
    if (member.packId) {
      await tx.pack.updateMany({
        where: { id: member.packId, leaderId: memberId },
        data: { leaderId: null },
      });
    }
    if (previousKpId && (member.packId || previousKpId !== kp.id)) {
      await tx.kP.updateMany({
        where: { id: previousKpId, leaderId: memberId },
        data: { leaderId: null },
      });
    }
    const previous = await tx.memberPackHistory.findFirst({
      where: { memberId },
      orderBy: { changedAt: 'desc' },
    });
    const changedAt = new Date(Math.max(Date.now(), (previous?.changedAt.getTime() ?? 0) + 1));
    await tx.member.update({
      where: { id: memberId },
      data: { packId, directKpId, packJoinedAt: pack ? changedAt : null },
    });
    await tx.memberPackHistory.create({
      data: {
        memberId,
        previousPackId: member.packId,
        previousDirectKpId: member.directKpId,
        packId,
        directKpId,
        changedAt,
      },
    });
    await this.audit(
      tx,
      actor,
      pack ? 'MEMBER_PACK_TRANSFER' : 'MEMBER_KP_TRANSFER',
      'Member',
      memberId,
      `Состав: ${member.pack ? `пак «${member.pack.name}»` : member.directKp ? `КП «${member.directKp.name}»` : 'без КП и пака'} → ${pack ? `пак «${pack.name}»` : `КП «${kp.name}»`}`,
    );
  }

  private async transferPack(tx: Tx, packId: string, kpId: string, actor: SessionUser) {
    const pack = await tx.pack.findUnique({
      where: { id: packId },
      include: { kp: true, members: { select: { id: true } } },
    });
    if (!pack) throw new NotFoundException('Пак не найден');
    const targetKp = await tx.kP.findUnique({ where: { id: kpId } });
    if (!targetKp) throw new NotFoundException('КП не найдена');
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
    // PACK следует за паком: его КП в ивентах должна оставаться согласованной.
    await tx.event.updateMany({ where: { scope: 'PACK', packId }, data: { kpId } });
    await tx.packMembershipHistory.create({
      data: { packId, previousKpId: pack.kpId, kpId, changedAt },
    });
    await this.audit(
      tx,
      actor,
      'PACK_KP_TRANSFER',
      'Pack',
      packId,
      `Перенос пака «${pack.name}» из КП «${pack.kp.name}» в КП «${targetKp.name}»`,
    );
  }

  async createKp(body: unknown, actor: SessionUser) {
    const input = this.parse(orgCreateKpSchema, body);
    return serializable(
      this.db,
      async (tx) => {
        const current = await this.activeActor(tx, actor);
        this.requirePermission(can(current, 'org.create_kp'));
        if (input.packIds.length) this.requirePermission(can(current, 'members.manage'));
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

  async editKp(kpId: string, body: unknown, actor: SessionUser) {
    const input = this.parse(orgEditKpSchema, body);
    return serializable(
      this.db,
      async (tx) => {
        const current = await this.activeActor(tx, actor);
        const kp = await tx.kP.findUnique({ where: { id: kpId } });
        if (!kp) throw new NotFoundException('КП не найдена');
        this.requirePermission(canManageKp(current, 'org.edit_kp', kp));
        if (kp.name === input.name) return kp;
        const updated = await tx.kP.update({ where: { id: kpId }, data: input });
        await this.audit(
          tx,
          actor,
          'KP_UPDATE',
          'KP',
          kpId,
          `Название КП: «${kp.name}» → «${updated.name}»`,
        );
        return updated;
      },
      true,
    );
  }

  async createPack(body: unknown, actor: SessionUser) {
    const input = this.parse(orgCreatePackSchema, body);
    return serializable(
      this.db,
      async (tx) => {
        const current = await this.activeActor(tx, actor);
        const kp = await tx.kP.findUnique({ where: { id: input.kpId } });
        if (!kp) throw new NotFoundException('КП не найдена');
        this.requirePermission(canManageKp(current, 'org.create_pack', kp));
        const pack = await tx.pack.create({ data: { name: input.name, kpId: input.kpId } });
        for (const memberId of input.memberIds)
          await this.transferMember(tx, memberId, kp, pack, current, true);
        await this.audit(
          tx,
          actor,
          'PACK_CREATE',
          'Pack',
          pack.id,
          `Создан пак «${pack.name}» в КП «${kp.name}»`,
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
        const current = await this.activeActor(tx, actor);
        if ('packId' in input) {
          const pack = await tx.pack.findUnique({
            where: { id: input.packId },
            include: { kp: { select: kpFields } },
          });
          if (!pack) throw new NotFoundException('Пак не найден');
          await this.transferMember(tx, memberId, pack.kp, pack, current);
        } else {
          const kp = await tx.kP.findUnique({ where: { id: input.kpId }, select: kpFields });
          if (!kp) throw new NotFoundException('КП не найдена');
          await this.transferMember(tx, memberId, kp, null, current);
        }
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
        this.requirePermission(can(await this.activeActor(tx, actor), 'members.manage'));
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
        this.requirePermission(can(await this.activeActor(tx, actor), 'members.manage'));
        const kp = await tx.kP.findUnique({ where: { id: kpId } });
        if (!kp) throw new NotFoundException('КП не найдена');
        if (
          input.memberId &&
          !(await tx.member.findFirst({
            where: { id: input.memberId, ...kpMembership(kpId), blockedAt: null },
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
          `Лидер КП «${kp.name}»: ${await this.leaderName(tx, kp.leaderId)} → ${await this.leaderName(tx, input.memberId)}`,
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
        const current = await this.activeActor(tx, actor);
        const pack = await tx.pack.findUnique({ where: { id: packId }, include: { kp: true } });
        if (!pack) throw new NotFoundException('Пак не найден');
        this.requirePermission(
          can(current, 'members.manage') || pack.kp.leaderId === current.memberId,
        );
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
          `Лидер пака «${pack.name}»: ${await this.leaderName(tx, pack.leaderId)} → ${await this.leaderName(tx, input.memberId)}`,
        );
        return { ok: true as const };
      },
      true,
    );
  }
}

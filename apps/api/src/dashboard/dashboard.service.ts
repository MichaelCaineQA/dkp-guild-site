import { Injectable } from '@nestjs/common';
import {
  canViewGuildGearScore,
  can,
  getMoscowDayBounds,
  selectDashboardEvents,
  sortTeamMembers,
  type DashboardData,
  type PermissionActor,
} from '@dkp/shared';
import type { PrismaClient } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { AuctionsService } from '../auctions/auctions.service';
export type DashboardDb = Pick<
  PrismaClient,
  'event' | 'member' | 'pack' | 'gearScoreRecord' | 'guild'
>;
@Injectable()
export class DashboardService {
  constructor(
    private readonly db: DashboardDb,
    private readonly audit: AuditService,
    private readonly auctions: AuctionsService,
  ) {}
  async get(actor: PermissionActor, now = new Date()): Promise<DashboardData> {
    const { start, end } = getMoscowDayBounds(now);
    const [events, team, audit, guild, myAuction] = await Promise.all([
      this.db.event.findMany({
        where: { startsAt: { gte: start, lt: end }, status: { not: 'CANCELLED' } },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        select: {
          id: true,
          name: true,
          eventTypeId: true,
          eventType: { select: { name: true } },
          mode: true,
          status: true,
          startsAt: true,
          endsAt: true,
          dkpReward: true,
          raidLeadId: true,
          creatorId: true,
          raidLead: { select: { nickname: true } },
          place: true,
          notes: true,
        },
      }),
      this.team(actor),
      actor.memberId || can(actor, 'audit.view') ? this.audit.list({ limit: 10 }, actor) : Promise.resolve(null),
      this.db.guild.findFirst({
        orderBy: { createdAt: 'asc' },
        select: { gameTimeAnchor: true, gameTimeDayMinutes: true, gameTimeNightMinutes: true },
      }),
      // Виджет «Мой аукцион» (план 2.8): лот с ближайшим окончанием среди
      // ставок игрока; обновляется при открытии страницы, без realtime.
      this.auctions.myNearestBidLot(actor.memberId ?? null),
    ]);
    return {
      generatedAt: now.toISOString(),
      events: selectDashboardEvents(events, now).map(
        ({ eventType, raidLead, startsAt, endsAt, ...event }) => ({
          ...event,
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          eventTypeName: eventType.name,
          raidLeadName: raidLead.nickname,
        }),
      ),
      team,
      auction: myAuction,
      audit:
        audit?.entries.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })) ?? null,
      gameTime: guild ? { ...guild, gameTimeAnchor: guild.gameTimeAnchor.toISOString() } : null,
    };
  }
  private async team(actor: PermissionActor): Promise<DashboardData['team']> {
    if (!actor.memberId) return null;
    const self = await this.db.member.findUnique({
      where: { id: actor.memberId },
      select: { packId: true },
    });
    if (!self?.packId) return null;
    const pack = await this.db.pack.findUnique({
      where: { id: self.packId },
      select: {
        id: true,
        name: true,
        leaderId: true,
        members: {
          select: {
            id: true,
            avatar: true,
            avatarColor: true,
            nickname: true,
            rank: true,
            weapons: true,
            combatRole: true,
            createdAt: true,
            packJoinedAt: true,
          },
        },
      },
    });
    if (!pack) return null;
    // В общем виджете ни собственный профиль, ни лидерство не расширяет видимость GS.
    const privileged = canViewGuildGearScore(actor);
    const scores = privileged
      ? await this.db.gearScoreRecord.findMany({
          where: {
            memberId: { in: pack.members.map((m) => m.id) },
            NOT: { screenshotIds: { isEmpty: true } },
          },
          distinct: ['memberId'],
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { memberId: true, value: true },
        })
      : [];
    const score = new Map(scores.map((row) => [row.memberId, row.value]));
    return {
      id: pack.id,
      name: pack.name,
      members: sortTeamMembers(pack.members, pack.leaderId).map((m) => ({
        id: m.id,
        avatar: m.avatar as import('@dkp/shared').Avatar | null,
        avatarColor: m.avatarColor as import('@dkp/shared').AvatarColor | null,
        nickname: m.nickname,
        rank: m.rank,
        weapons: m.weapons,
        combatRole: m.combatRole,
        leader: m.id === pack.leaderId,
        ...(privileged ? { gearScore: score.get(m.id) ?? null } : {}),
      })),
    };
  }
}

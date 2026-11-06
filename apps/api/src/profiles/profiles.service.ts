import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canEditOwnProfile,
  computeBalance,
  updateOwnProfileSchema,
  type CombatRole,
  type Weapon,
  formatWeapons,
  type PlayerProfile,
  type Rank,
  type PermissionActor,
} from '@dkp/shared';

interface ProfileMember {
  weapons?: Weapon[];
  id: string;
  nickname: string;
  combatRole: CombatRole | null;
  rank: Rank;
  user: { username: string } | null;
}
export interface ProfileTransaction {
  member: {
    findUnique(args: {
      where: { id: string };
      include: { user: { select: { username: true } } };
    }): Promise<ProfileMember | null>;
    update(args: {
      where: { id: string };
      data: { combatRole: CombatRole; weapons: Weapon[] };
    }): Promise<unknown>;
  };
  auditLog: {
    create(args: {
      data: {
        actorMemberId: string;
        action: string;
        entityType: string;
        entityId: string;
        comment: string;
      };
    }): Promise<unknown>;
  };
}
export interface ProfilesDb extends ProfileTransaction {
  dkpEntry: {
    findMany(args: {
      where: { memberId: string };
      orderBy: Array<{ createdAt?: 'desc'; id?: 'desc' }>;
    }): Promise<
      Array<{
        id: string;
        type: string;
        amount: number;
        comment: string | null;
        eventId: string | null;
        createdAt: Date;
      }>
    >;
  };
  $transaction<T>(work: (tx: ProfileTransaction) => Promise<T>): Promise<T>;
}

@Injectable()
export class ProfilesService {
  constructor(private readonly db: ProfilesDb) {}

  async get(id: string): Promise<PlayerProfile> {
    const member = await this.mustExist(this.db, id);
    // Баланс по всему append-only журналу, без потолка по количеству записей.
    const entries = await this.db.dkpEntry.findMany({
      where: { memberId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    return {
      id: member.id,
      nickname: member.nickname,
      discord: member.user?.username ?? null,
      rank: member.rank,
      combatRole: member.combatRole,
      weapons: member.weapons ?? [],
      balance: computeBalance(entries),
      recentEntries: entries.slice(0, 10).map((entry) => ({
        id: entry.id,
        type: entry.type,
        amount: entry.amount,
        comment: entry.comment,
        eventId: entry.eventId,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  async updateOwn(id: string, body: unknown, actor: PermissionActor) {
    if (!canEditOwnProfile(actor, id))
      throw new ForbiddenException('Можно менять только свою роль в бою');
    const parsed = updateOwnProfileSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException(
        'Укажите роль, два разных оружия и комментарий от 3 до 500 символов',
      );
    const input = parsed.data;
    await this.db.$transaction(async (tx) => {
      const member = await this.mustExist(tx, id);
      if (
        member.combatRole === input.combatRole &&
        JSON.stringify(member.weapons ?? []) === JSON.stringify(input.weapons)
      )
        return;
      await tx.member.update({
        where: { id },
        data: { combatRole: input.combatRole, weapons: input.weapons },
      });
      await tx.auditLog.create({
        data: {
          actorMemberId: id,
          action: 'MEMBER_UPDATE',
          entityType: 'Member',
          entityId: id,
          comment: `Роль: ${member.combatRole ?? 'не указана'} → ${input.combatRole}; оружия: ${formatWeapons(member.weapons ?? [])} → ${formatWeapons(input.weapons)}. ${input.comment}`,
        },
      });
    });
    return { ok: true };
  }

  private async mustExist(db: ProfileTransaction, id: string) {
    const member = await db.member.findUnique({
      where: { id },
      include: { user: { select: { username: true } } },
    });
    if (!member) throw new NotFoundException('Игрок не найден');
    return member;
  }
}

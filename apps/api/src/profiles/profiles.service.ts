import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canEditOwnProfile,
  canViewProfileGearScore,
  computeBalance,
  updateOwnProfileSchema,
  type CombatRole,
  type Weapon,
  formatWeapons,
  type PlayerProfile,
  type Rank,
  type PermissionActor,
  type Avatar,
  type AvatarColor,
} from '@dkp/shared';

interface ProfileMember {
  avatar?: Avatar | null;
  avatarColor?: AvatarColor | null;
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
      data: {
        combatRole?: CombatRole;
        weapons?: Weapon[];
        avatar?: Avatar | null;
        avatarColor?: AvatarColor | null;
      };
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
  gearScoreRecord: {
    findFirst(args: {
      where: { memberId: string; NOT: { screenshotIds: { isEmpty: true } } };
      orderBy: Array<{ createdAt?: 'desc'; id?: 'desc' }>;
    }): Promise<{ value: number; screenshotIds: string[]; createdAt: Date } | null>;
  };
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

  async get(id: string, actor?: PermissionActor): Promise<PlayerProfile> {
    const member = await this.mustExist(this.db, id);
    // Баланс по всему append-only журналу, без потолка по количеству записей.
    const entries = await this.db.dkpEntry.findMany({
      where: { memberId: id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    const gs =
      actor && canViewProfileGearScore(actor, id)
        ? await this.db.gearScoreRecord.findFirst({
            where: { memberId: id, NOT: { screenshotIds: { isEmpty: true } } },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          })
        : undefined;
    return {
      ...(gs === undefined
        ? {}
        : {
            gearScore: gs
              ? {
                  value: gs.value,
                  screenshotIds: gs.screenshotIds,
                  createdAt: gs.createdAt.toISOString(),
                }
              : null,
          }),
      id: member.id,
      avatar: member.avatar ?? null,
      avatarColor: member.avatarColor ?? null,
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
      const otherFieldsChanged =
        (input.combatRole !== undefined && member.combatRole !== input.combatRole) ||
        (input.weapons !== undefined &&
          JSON.stringify(member.weapons ?? []) !== JSON.stringify(input.weapons));
      if (otherFieldsChanged && !input.comment)
        throw new BadRequestException('Укажите комментарий от 3 до 500 символов');
      if (
        !otherFieldsChanged &&
        (input.avatar === undefined || (member.avatar ?? null) === input.avatar) &&
        (input.avatarColor === undefined || (member.avatarColor ?? null) === input.avatarColor)
      )
        return;
      await tx.member.update({
        where: { id },
        data: {
          ...(input.combatRole !== undefined ? { combatRole: input.combatRole } : {}),
          ...(input.weapons !== undefined ? { weapons: input.weapons } : {}),
          ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
          ...(input.avatarColor !== undefined ? { avatarColor: input.avatarColor } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorMemberId: id,
          action: 'MEMBER_UPDATE',
          entityType: 'Member',
          entityId: id,
          comment: `Роль: ${member.combatRole ?? 'не указана'} → ${input.combatRole ?? member.combatRole ?? 'не указана'}; оружия: ${formatWeapons(member.weapons ?? [])} → ${formatWeapons(input.weapons ?? member.weapons ?? [])}; аватар: ${member.avatar ?? 'не выбран'} → ${input.avatar === undefined ? (member.avatar ?? 'не выбран') : (input.avatar ?? 'не выбран')}; фон: ${member.avatarColor ?? 'автоматически'} → ${input.avatarColor === undefined ? (member.avatarColor ?? 'автоматически') : (input.avatarColor ?? 'автоматически')}.${input.comment ? ` ${input.comment}` : ''}`,
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

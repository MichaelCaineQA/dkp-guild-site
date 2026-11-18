import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  canChangeProfileField,
  canEditOwnProfile,
  canViewProfileGearScore,
  isGearScoreStale,
  computeBalance,
  parseSettingValue,
  SETTING_DEFAULTS,
  updateOwnProfileSchema,
  PROFILE_LOOT_LIMIT,
  type CombatRole,
  type Weapon,
  formatWeapons,
  type PlayerProfile,
  type ProfileLootRow,
  type Rank,
  type PermissionActor,
  type Avatar,
  type AvatarColor,
  type PrimeTimeSlot,
} from '@dkp/shared';
import { gearScoreStaleDays } from '../settings/gear-score-settings';

interface ProfileMember {
  timeZone: string;
  primeTime: PrimeTimeSlot[];
  avatar?: Avatar | null;
  avatarColor?: AvatarColor | null;
  weapons?: Weapon[];
  id: string;
  nickname: string;
  combatRole: CombatRole | null;
  combatRoleChangedAt: Date | null;
  preferredItemId: string | null;
  preferredItemChangedAt: Date | null;
  preferredArchbossItemId: string | null;
  preferredArchbossItemChangedAt: Date | null;
  rank: Rank;
  user: { username: string } | null;
}
export interface ProfileTransaction {
  member: {
    findUnique(args: {
      where: { id: string };
      include: {
        user: { select: { username: true } };
        preferredItem: { select: { id: true; name: true } };
        preferredArchbossItem: { select: { id: true; name: true } };
        primeTime: true;
      };
    }): Promise<
      | (ProfileMember & {
          preferredItem: { id: string; name: string } | null;
          preferredArchbossItem: { id: string; name: string } | null;
        })
      | null
    >;
    findFirst(args: { where: { nickname: string } }): Promise<{ id: string } | null>;
    update(args: {
      where: { id: string };
      data: {
        nickname?: string;
        combatRole?: CombatRole;
        prevCombatRole?: CombatRole | null;
        combatRoleChangedAt?: Date | null;
        weapons?: Weapon[];
        avatar?: Avatar | null;
        avatarColor?: AvatarColor | null;
        preferredItemId?: string | null;
        prevPreferredItemId?: string | null;
        preferredItemChangedAt?: Date | null;
        preferredArchbossItemId?: string | null;
        prevPreferredArchbossItemId?: string | null;
        preferredArchbossItemChangedAt?: Date | null;
        timeZone?: string;
        primeTime?: { deleteMany: Record<string, never>; create: PrimeTimeSlot[] };
      };
    }): Promise<unknown>;
  };
  item: {
    findUnique(args: {
      where: { id: string };
    }): Promise<{ id: string; name: string; isArchboss: boolean } | null>;
  };
  setting: {
    findMany(args: {
      where: { key: { in: string[] } };
      select: { key: true; value: true };
    }): Promise<{ key: string; value: unknown }[]>;
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
  lootAward: {
    findMany(args: {
      where: { winnerId: string };
      orderBy: Array<{ createdAt?: 'desc'; id?: 'desc' }>;
      take?: number;
      include: {
        auction: { include: { lootDrop: { include: { event: true; item: true } } } };
      };
    }): Promise<StoredProfileAward[]>;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
  $transaction<T>(work: (tx: ProfileTransaction) => Promise<T>): Promise<T>;
}

/** Выдача для блока «Полученный лут» профиля (план 2.5). */
interface StoredProfileAward {
  id: string;
  finalPrice: number;
  markupPct: number;
  discountPct: number;
  createdAt: Date;
  auction: {
    id: string;
    lootDrop: {
      /** null — лот вне ивента, «хранилище гильдии» (#137). */
      event: { id: string; name: string; startsAt: Date } | null;
      item: { name: string; rarity: string | null };
    };
  };
}

@Injectable()
export class ProfilesService {
  constructor(
    private readonly db: ProfilesDb,
    private readonly now: () => Date = () => new Date(),
  ) {}

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
    const staleDays = gs
      ? await gearScoreStaleDays(this.db)
      : SETTING_DEFAULTS['profile.gearScoreStaleDays'];
    // Полученный лут (план 2.5) — фактические выдачи лотов игрока,
    // свежие сверху; полная история — лут-лог с фильтром по игроку.
    const [awards, lootTotal] = await Promise.all([
      this.db.lootAward.findMany({
        where: { winnerId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: PROFILE_LOOT_LIMIT,
        include: { auction: { include: { lootDrop: { include: { event: true, item: true } } } } },
      }),
      this.db.lootAward.count({ where: { winnerId: id } }),
    ]);
    return {
      ...(gs === undefined
        ? {}
        : {
            gearScore: gs
              ? {
                  value: gs.value,
                  screenshotIds: gs.screenshotIds,
                  createdAt: gs.createdAt.toISOString(),
                  stale: isGearScoreStale([gs], staleDays, this.now()),
                }
              : null,
          }),
      id: member.id,
      timeZone: member.timeZone,
      primeTime: member.primeTime.map(({ weekday, fromMinute, toMinute }) => ({
        weekday,
        fromMinute,
        toMinute,
      })),
      avatar: member.avatar ?? null,
      avatarColor: member.avatarColor ?? null,
      nickname: member.nickname,
      discord: member.user?.username ?? null,
      rank: member.rank,
      combatRole: member.combatRole,
      weapons: member.weapons ?? [],
      preferredItem: member.preferredItem
        ? { id: member.preferredItem.id, name: member.preferredItem.name }
        : null,
      preferredItemChangedAt: member.preferredItemChangedAt?.toISOString() ?? null,
      preferredArchbossItem: member.preferredArchbossItem
        ? { id: member.preferredArchbossItem.id, name: member.preferredArchbossItem.name }
        : null,
      preferredArchbossItemChangedAt: member.preferredArchbossItemChangedAt?.toISOString() ?? null,
      combatRoleChangedAt: member.combatRoleChangedAt?.toISOString() ?? null,
      balance: computeBalance(entries),
      recentEntries: entries.slice(0, 10).map((entry) => ({
        id: entry.id,
        type: entry.type,
        amount: entry.amount,
        comment: entry.comment,
        eventId: entry.eventId,
        createdAt: entry.createdAt.toISOString(),
      })),
      loot: awards.map((award) => this.toLootRow(award)),
      lootTotal,
    };
  }

  private toLootRow(award: StoredProfileAward): ProfileLootRow {
    const drop = award.auction.lootDrop;
    return {
      awardId: award.id,
      lotId: award.auction.id,
      itemName: drop.item.name,
      rarity: drop.item.rarity,
      finalPrice: award.finalPrice,
      markupPct: award.markupPct,
      discountPct: award.discountPct,
      eventId: drop.event?.id ?? null,
      eventName: drop.event?.name ?? null,
      eventStartsAt: drop.event?.startsAt.toISOString() ?? null,
      createdAt: award.createdAt.toISOString(),
    };
  }

  /**
   * Смена своих полей (план 2.5). Боевая роль и предпочитаемый предмет
   * меняются не чаще раза в настройочный интервал (решение 18) — у каждого
   * поля свой отсчёт, первый выбор сразу; при смене сохраняется прежнее
   * значение с датой — снимок для цены открытых лотов (план 6, п. 6).
   */
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
      const now = this.now();

      // Предпочитаемый предмет должен существовать (null — снять выбор);
      // обычное желание — предмет без отметки «Архибосс», архибосс-оружие —
      // только с ней (issue #208): списки в профиле не пересекаются.
      let preferredName: string | null = null;
      if (input.preferredItemId) {
        const item = await tx.item.findUnique({ where: { id: input.preferredItemId } });
        if (!item) throw new NotFoundException('Предмет не найден');
        if (item.isArchboss)
          throw new BadRequestException('Архибосс-предмет выбирается в списке архибосс-оружия');
        preferredName = item.name;
      }
      let preferredArchbossName: string | null = null;
      if (input.preferredArchbossItemId) {
        const item = await tx.item.findUnique({ where: { id: input.preferredArchbossItemId } });
        if (!item) throw new NotFoundException('Предмет не найден');
        if (!item.isArchboss)
          throw new BadRequestException('В списке архибосс-оружия — только предметы «Архибосс»');
        preferredArchbossName = item.name;
      }

      const roleChanged = input.combatRole !== undefined && input.combatRole !== member.combatRole;
      const preferredChanged =
        input.preferredItemId !== undefined && input.preferredItemId !== member.preferredItemId;
      const preferredArchbossChanged =
        input.preferredArchbossItemId !== undefined &&
        input.preferredArchbossItemId !== member.preferredArchbossItemId;
      // Ник уникален (аудит F03): чужой занятый — 409, свой прежний — не смена
      const nicknameChanged = input.nickname !== undefined && input.nickname !== member.nickname;
      if (nicknameChanged) {
        const clash = await tx.member.findFirst({ where: { nickname: input.nickname! } });
        if (clash && clash.id !== id) {
          throw new ConflictException('Член с таким ником уже есть');
        }
      }
      const primeTimeChanged =
        input.primeTime !== undefined &&
        JSON.stringify(
          member.primeTime.map(({ weekday, fromMinute, toMinute }) => ({
            weekday,
            fromMinute,
            toMinute,
          })),
        ) !== JSON.stringify(input.primeTime);
      const timeZoneChanged = input.timeZone !== undefined && input.timeZone !== member.timeZone;
      const otherFieldsChanged =
        roleChanged ||
        nicknameChanged ||
        (input.weapons !== undefined &&
          JSON.stringify(member.weapons ?? []) !== JSON.stringify(input.weapons)) ||
        preferredChanged ||
        preferredArchbossChanged ||
        primeTimeChanged ||
        timeZoneChanged;
      if (otherFieldsChanged && !input.comment)
        throw new BadRequestException('Укажите комментарий от 3 до 500 символов');

      // Кулдаун (план 2.5, решение 18): роль и предмет — независимо.
      const cooldownDays = await this.readCooldownDays(tx);
      if (roleChanged && !canChangeProfileField(member.combatRoleChangedAt, cooldownDays, now)) {
        throw new ConflictException(
          `Боевую роль можно менять раз в ${cooldownDays} дн. — не раньше ${nextChangeDate(member.combatRoleChangedAt, cooldownDays)}`,
        );
      }
      if (
        preferredChanged &&
        !canChangeProfileField(member.preferredItemChangedAt, cooldownDays, now)
      ) {
        throw new ConflictException(
          `Предпочитаемый предмет можно менять раз в ${cooldownDays} дн. — не раньше ${nextChangeDate(member.preferredItemChangedAt, cooldownDays)}`,
        );
      }
      if (
        preferredArchbossChanged &&
        !canChangeProfileField(member.preferredArchbossItemChangedAt, cooldownDays, now)
      ) {
        throw new ConflictException(
          `Архибосс-оружие можно менять раз в ${cooldownDays} дн. — не раньше ${nextChangeDate(member.preferredArchbossItemChangedAt, cooldownDays)}`,
        );
      }

      if (
        !otherFieldsChanged &&
        (input.avatar === undefined || (member.avatar ?? null) === input.avatar) &&
        (input.avatarColor === undefined || (member.avatarColor ?? null) === input.avatarColor)
      )
        return;
      await tx.member.update({
        where: { id },
        data: {
          ...(nicknameChanged ? { nickname: input.nickname! } : {}),
          ...(input.combatRole !== undefined ? { combatRole: input.combatRole } : {}),
          ...(roleChanged ? { prevCombatRole: member.combatRole, combatRoleChangedAt: now } : {}),
          ...(input.weapons !== undefined ? { weapons: input.weapons } : {}),
          ...(input.avatar !== undefined ? { avatar: input.avatar } : {}),
          ...(input.avatarColor !== undefined ? { avatarColor: input.avatarColor } : {}),
          ...(timeZoneChanged ? { timeZone: input.timeZone } : {}),
          ...(primeTimeChanged ? { primeTime: { deleteMany: {}, create: input.primeTime! } } : {}),
          ...(input.preferredItemId !== undefined
            ? { preferredItemId: input.preferredItemId }
            : {}),
          ...(preferredChanged
            ? { prevPreferredItemId: member.preferredItemId, preferredItemChangedAt: now }
            : {}),
          ...(input.preferredArchbossItemId !== undefined
            ? { preferredArchbossItemId: input.preferredArchbossItemId }
            : {}),
          ...(preferredArchbossChanged
            ? {
                prevPreferredArchbossItemId: member.preferredArchbossItemId,
                preferredArchbossItemChangedAt: now,
              }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorMemberId: id,
          action: 'MEMBER_UPDATE',
          entityType: 'Member',
          entityId: id,
          comment: `ник: ${nicknameChanged ? `«${member.nickname}» → «${input.nickname}»` : 'без изменений'}; роль: ${member.combatRole ?? 'не указана'} → ${input.combatRole ?? member.combatRole ?? 'не указана'}; оружия: ${formatWeapons(member.weapons ?? [])} → ${formatWeapons(input.weapons ?? member.weapons ?? [])}; предпочитаемый предмет: ${member.preferredItem ? `«${member.preferredItem.name}»` : 'не выбран'} → ${input.preferredItemId === undefined ? 'без изменений' : preferredName ? `«${preferredName}»` : 'не выбран'}; архибосс-оружие: ${member.preferredArchbossItem ? `«${member.preferredArchbossItem.name}»` : 'не выбрано'} → ${input.preferredArchbossItemId === undefined ? 'без изменений' : preferredArchbossName ? `«${preferredArchbossName}»` : 'не выбрано'}; аватар: ${member.avatar ?? 'не выбран'} → ${input.avatar === undefined ? (member.avatar ?? 'не выбран') : (input.avatar ?? 'не выбран')}; фон: ${member.avatarColor ?? 'автоматически'} → ${input.avatarColor === undefined ? (member.avatarColor ?? 'автоматически') : (input.avatarColor ?? 'автоматически')}; прайм-тайм: ${primeTimeChanged ? 'изменён' : 'без изменений'}; таймзона: ${member.timeZone} → ${input.timeZone ?? member.timeZone}.${input.comment ? ` ${input.comment}` : ''}`,
        },
      });
    });
    return { ok: true };
  }

  /** Интервал смены роли/предмета из настроек (дефолт реестра — 14 дней). */
  private async readCooldownDays(tx: ProfileTransaction): Promise<number> {
    const rows = await tx.setting.findMany({
      where: { key: { in: ['auction.profileChangeCooldownDays'] } },
      select: { key: true, value: true },
    });
    const stored = rows.find((row) => row.key === 'auction.profileChangeCooldownDays');
    return parseSettingValue(
      'auction.profileChangeCooldownDays',
      stored?.value ?? SETTING_DEFAULTS['auction.profileChangeCooldownDays'],
    );
  }

  private async mustExist(db: ProfileTransaction, id: string) {
    const member = await db.member.findUnique({
      where: { id },
      include: {
        user: { select: { username: true } },
        preferredItem: { select: { id: true, name: true } },
        preferredArchbossItem: { select: { id: true, name: true } },
        primeTime: true,
      },
    });
    if (!member) throw new NotFoundException('Игрок не найден');
    return member;
  }
}

/** Дата следующей возможной смены для сообщения об отказе (локальная дата). */
function nextChangeDate(changedAt: Date | null, cooldownDays: number): string {
  const from = changedAt ?? new Date(0);
  return new Date(from.getTime() + cooldownDays * 86_400_000).toLocaleDateString('ru-RU');
}

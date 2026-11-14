import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  BLOCKABLE_RANKS,
  blockMemberSchema,
  changeRankSchema,
  createMemberSchema,
  rosterQuerySchema,
  updateMemberSchema,
  formatWeapons,
  isAvailableAt,
  type PrimeTimeSlot,
  type Weapon,
  type ChangeRankInput,
  type CreateMemberInput,
  type RosterQuery,
  type UpdateMemberInput,
} from '@dkp/shared';
import { serializable } from '../prisma/serializable';
import { NOOP_AUCTION_EVENTS, type AuctionEventsPort } from '../realtime/auction-events';

/** Строка состава для UI. */
export interface RosterRow {
  avatar: string | null;
  avatarColor: string | null;
  weapons: Weapon[];
  id: string;
  nickname: string;
  rank: string;
  combatRole: string | null;
  discord: string | null;
}

/** Строка вкладки «Заблокированные» (issue #149). */
export interface BlockedMemberRow extends RosterRow {
  blockedAt: string;
}

export interface MemberRow {
  avatar?: string | null;
  avatarColor?: string | null;
  weapons?: Weapon[];
  blockedAt?: Date | null;
  id: string;
  nickname: string;
  rank: string;
  combatRole: string | null;
  userId: string | null;
}

export interface AuditWriter {
  create(args: {
    data: {
      actorMemberId: string | null;
      actorIsAdmin?: boolean;
      action: string;
      entityType: string;
      entityId: string;
      comment?: string;
    };
  }): Promise<unknown>;
}

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface MembersDb {
  $transaction<T>(
    work: (tx: Omit<MembersDb, '$transaction'>) => Promise<T>,
    options: { isolationLevel: 'Serializable'; timeout?: number },
  ): Promise<T>;
  member: {
    findMany(args: {
      where: {
        rank?: string;
        combatRole?: string;
        weapons?: { has: Weapon };
        blockedAt?: Date | null | { not: null };
      };
      orderBy: { nickname: 'asc' } | { blockedAt: 'desc' };
      include: { user: { select: { username: true } }; primeTime?: true };
    }): Promise<
      Array<{
        avatar?: string | null;
        avatarColor?: string | null;
        blockedAt?: Date | null;
        id: string;
        nickname: string;
        rank: string;
        combatRole: string | null;
        weapons?: Weapon[];
        user: { username: string } | null;
        timeZone?: string;
        primeTime?: PrimeTimeSlot[];
      }>
    >;
    findUnique(args: { where: { id: string } }): Promise<MemberRow | null>;
    findFirst(args: { where: { nickname?: string; rank?: string } }): Promise<MemberRow | null>;
    count(args: { where: { rank: string } }): Promise<number>;
    create(args: {
      data: { nickname: string; rank: string; combatRole: string | null; weapons: Weapon[] };
    }): Promise<MemberRow>;
    update(args: {
      where: { id: string };
      data: {
        nickname?: string;
        combatRole?: string | null;
        rank?: string;
        weapons?: Weapon[];
        blockedAt?: Date | null;
      };
    }): Promise<MemberRow>;
  };
  bid: {
    findMany(args: {
      where: { memberId: string; auction: { status: string } };
      select: { auctionId: true };
    }): Promise<Array<{ auctionId: string }>>;
    deleteMany(args: {
      where: { memberId: string; auction: { status: string } };
    }): Promise<{ count: number }>;
  };
  auditLog: AuditWriter;
}

/** Действующий пользователь сессии (см. SessionUser в @dkp/shared). */
export interface Actor {
  memberId: string | null;
  isAdmin: boolean;
  userId: string;
}

/**
 * Члены гильдии (issue #6): состав, создание/редактирование (офицеры+),
 * смена рангов (Глава/Админ) — каждое действие с записью в AuditLog.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly db: MembersDb,
    private readonly now: () => Date = () => new Date(),
    private readonly events: AuctionEventsPort = NOOP_AUCTION_EVENTS,
  ) {}

  /** Состав с фильтрами по рангу и роли в бою — всем членам гильдии.
   *  Заблокированные скрыты (issue #149) — они на отдельной вкладке. */
  async roster(query: unknown): Promise<RosterRow[]> {
    const parsed = rosterQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Некорректные фильтры состава');
    const filters: RosterQuery = parsed.data;
    const where: {
      rank?: string;
      combatRole?: string;
      weapons?: { has: Weapon };
      blockedAt?: null;
    } = { blockedAt: null };
    if (filters.weapon) where.weapons = { has: filters.weapon };
    if (filters.rank) {
      where.rank = filters.rank;
    }
    if (filters.combatRole) {
      where.combatRole = filters.combatRole;
    }

    const members = await this.db.member.findMany({
      where,
      orderBy: { nickname: 'asc' },
      include: { user: { select: { username: true } }, ...(filters.availableNow ? { primeTime: true } : {}) },
    });
    const now = this.now();
    return members.filter((m) => !filters.availableNow || isAvailableAt(m.primeTime ?? [], m.timeZone ?? 'Europe/Moscow', now)).map((m) => ({
      id: m.id,
      avatar: m.avatar ?? null,
      avatarColor: m.avatarColor ?? null,
      nickname: m.nickname,
      rank: m.rank,
      combatRole: m.combatRole,
      weapons: m.weapons ?? [],
      discord: m.user?.username ?? null,
    }));
  }

  async getOne(id: string): Promise<RosterRow> {
    const member = await this.db.member.findUnique({ where: { id } });
    if (!member) {
      throw new NotFoundException('Член гильдии не найден');
    }
    return {
      id: member.id,
      avatar: member.avatar ?? null,
      avatarColor: member.avatarColor ?? null,
      nickname: member.nickname,
      rank: member.rank,
      combatRole: member.combatRole,
      weapons: member.weapons ?? [],
      discord: null, // имя Discord достаём списком; в карточке не критично
    };
  }

  /** Создание члена (members.manage): до привязки Discord — «пустышка». */
  async create(body: unknown, actor: Actor): Promise<MemberRow> {
    const parsed = createMemberSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Укажите ник, роль и два разных оружия');
    const input: CreateMemberInput = parsed.data;

    if (input.rank === 'ADMIN' || input.rank === 'GUILD_LEADER') {
      throw new ConflictException(
        'Роли «Админ» и «Глава» не создаются вручную (решение владельца)',
      );
    }

    const clash = await this.db.member.findFirst({ where: { nickname: input.nickname } });
    if (clash) {
      throw new ConflictException('Член с таким ником уже есть');
    }

    const member = await this.db.member.create({
      data: {
        nickname: input.nickname,
        rank: input.rank ?? 'MEMBER',
        combatRole: input.combatRole ?? null,
        weapons: input.weapons,
      },
    });
    await this.audit(actor, 'MEMBER_CREATE', member.id, `Создан член «${member.nickname}»`);
    return member;
  }

  /** Редактирование ника/роли в бою (members.manage). */
  async update(id: string, body: unknown, actor: Actor): Promise<MemberRow> {
    const parsed = updateMemberSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Укажите ник, роль и два разных оружия');
    const input: UpdateMemberInput = parsed.data;

    const existing = await this.mustExist(id);
    const clash = await this.db.member.findFirst({ where: { nickname: input.nickname } });
    if (clash && clash.id !== id) {
      throw new ConflictException('Член с таким ником уже есть');
    }

    const member = await this.db.member.update({
      where: { id },
      data: { nickname: input.nickname, combatRole: input.combatRole, weapons: input.weapons },
    });
    const changes: string[] = [];
    if (JSON.stringify(existing.weapons ?? []) !== JSON.stringify(member.weapons ?? []))
      changes.push(
        `оружия: ${formatWeapons(existing.weapons ?? [])} → ${formatWeapons(member.weapons ?? [])}`,
      );
    if (existing.nickname !== member.nickname) {
      changes.push(`ник «${existing.nickname}» → «${member.nickname}»`);
    }
    if (existing.combatRole !== member.combatRole) {
      changes.push(`роль в бою «${existing.combatRole ?? '—'}» → «${member.combatRole ?? '—'}»`);
    }
    await this.audit(actor, 'MEMBER_UPDATE', member.id, changes.join('; ') || 'Без изменений');
    return member;
  }

  /**
   * Смена ранга (members.change_rank, Глава/Админ): комментарий обязателен
   * (zod), уходит в AuditLog. Роли ADMIN и GUILD_LEADER назначать нельзя
   * (решение владельца): админ — один профиль только по кредам без Discord,
   * Глава — единственный и не назначается через сайт. Последнего Главу
   * понизить тоже нельзя.
   */
  async changeRank(id: string, body: unknown, actor: Actor): Promise<MemberRow> {
    const input: ChangeRankInput = changeRankSchema.parse(body);

    if (input.rank === 'ADMIN') throw new ConflictException('Ранг Админ не назначается участнику');

    if (input.rank === 'GUILD_LEADER') {
      if (!actor.isAdmin) throw new ForbiddenException('Назначить Главу может только Админ');
      return serializable(
        this.db,
        async (tx) => {
          const member = await tx.member.findUnique({ where: { id } });
          if (!member) throw new NotFoundException('Член гильдии не найден');
          if (member.rank === 'GUILD_LEADER') throw new ConflictException('У члена уже этот ранг');
          const previous = await tx.member.findFirst({ where: { rank: 'GUILD_LEADER' } });
          if (previous)
            await tx.member.update({ where: { id: previous.id }, data: { rank: 'MEMBER' } });
          const updated = await tx.member.update({ where: { id }, data: { rank: 'GUILD_LEADER' } });
          await tx.auditLog.create({
            data: {
              actorMemberId: actor.memberId,
              actorIsAdmin: actor.isAdmin,
              action: 'ROLE_CHANGE',
              entityType: 'Member',
              entityId: id,
              comment: `Админ назначил Главой ${member.nickname} (ранг ${member.rank} → GUILD_LEADER; прежний Глава: ${previous?.nickname ?? 'не назначен'}${previous ? ', GUILD_LEADER → MEMBER' : ''}). ${input.comment}`,
            },
          });
          if (previous)
            await tx.auditLog.create({
              data: {
                actorMemberId: actor.memberId,
                actorIsAdmin: actor.isAdmin,
                action: 'ROLE_CHANGE',
                entityType: 'Member',
                entityId: previous.id,
                comment: `Админ передал роль Главы участнику ${member.nickname}; ваш ранг: GUILD_LEADER → MEMBER. ${input.comment}`,
              },
            });
          return updated;
        },
        true,
      );
    }

    const member = await this.mustExist(id);
    if (member.rank === input.rank) {
      throw new ConflictException('У члена уже этот ранг');
    }
    // Единственного Главу понизить нельзя — даже если ранг пришёл легитимным
    // путём (защита не зависит от guard'а выше)
    if (member.rank === 'GUILD_LEADER') {
      const leaders = await this.db.member.count({ where: { rank: 'GUILD_LEADER' } });
      if (leaders <= 1) {
        throw new ConflictException('Нельзя понизить последнего Главу гильдии');
      }
    }

    const updated = await this.db.member.update({
      where: { id },
      data: { rank: input.rank },
    });
    await this.audit(
      actor,
      'ROLE_CHANGE',
      member.id,
      `Ранг «${member.rank}» → «${updated.rank}». ${input.comment}`,
    );
    return updated;
  }

  /**
   * Вкладка «Заблокированные» (issue #149, members.manage): покинувшие
   * гильдию с сохранёнными данными. Сортировка — свежие блокировки сверху.
   */
  async blocked(): Promise<BlockedMemberRow[]> {
    const members = await this.db.member.findMany({
      where: { blockedAt: { not: null } },
      orderBy: { blockedAt: 'desc' },
      include: { user: { select: { username: true } } },
    });
    return members.map((m) => ({
      id: m.id,
      avatar: m.avatar ?? null,
      avatarColor: m.avatarColor ?? null,
      nickname: m.nickname,
      rank: m.rank,
      combatRole: m.combatRole,
      weapons: m.weapons ?? [],
      discord: m.user?.username ?? null,
      blockedAt: (m.blockedAt ?? new Date(0)).toISOString(),
    }));
  }

  /**
   * Блокировка учётки покинувшего гильдию (issue #149, members.manage):
   * комментарий обязателен, действие уходит в аудит. Активные ставки
   * на открытых лотах удаляются той же сериализуемой транзакцией — заморозка
   * уходит вместе со ставками, ведущей становится лучшая из оставшихся.
   * Данные (ДКП, класс, роль, лут) сохраняются на случай возвращения.
   */
  async block(id: string, body: unknown, actor: Actor): Promise<BlockedMemberRow> {
    const parsed = blockMemberSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Укажите причину блокировки (3–500 символов)');
    }
    const blockedAt = this.now();
    const result = await serializable(
      this.db,
      async (tx) => {
        const member = await tx.member.findUnique({ where: { id } });
        if (!member) throw new NotFoundException('Член гильдии не найден');
        if (member.blockedAt) throw new ConflictException('Участник уже заблокирован');
        if (!BLOCKABLE_RANKS.has(member.rank)) {
          throw new ConflictException('Главу и админа блокировать нельзя');
        }
        const activeBids = await tx.bid.findMany({
          where: { memberId: id, auction: { status: 'OPEN' } },
          select: { auctionId: true },
        });
        if (activeBids.length > 0) {
          await tx.bid.deleteMany({
            where: { memberId: id, auction: { status: 'OPEN' } },
          });
        }
        const updated = await tx.member.update({
          where: { id },
          data: { blockedAt },
        });
        await tx.auditLog.create({
          data: {
            actorMemberId: actor.memberId,
            actorIsAdmin: actor.isAdmin,
            action: 'MEMBER_BLOCK',
            entityType: 'Member',
            entityId: id,
            comment:
              `Участник «${member.nickname}» заблокирован` +
              (activeBids.length > 0 ? `, снято активных ставок: ${activeBids.length}` : '') +
              `. ${parsed.data.comment}`,
          },
        });
        return { member: updated, affectedAuctionIds: [...new Set(activeBids.map((b) => b.auctionId))] };
      },
      true,
    );
    // Realtime — строго после фиксации в БД (issue #97): комнатам затронутых
    // лотов уходит свежий срез без ставок заблокированного.
    for (const auctionId of result.affectedAuctionIds) {
      this.events.bidsRemoved(auctionId);
    }
    return {
      id: result.member.id,
      avatar: result.member.avatar ?? null,
      avatarColor: result.member.avatarColor ?? null,
      nickname: result.member.nickname,
      rank: result.member.rank,
      combatRole: result.member.combatRole,
      weapons: result.member.weapons ?? [],
      discord: null,
      blockedAt: blockedAt.toISOString(),
    };
  }

  /**
   * Разблокировка (issue #149, members.manage): человек вернулся в гильдию —
   * доступ возвращается, ранг и история не менялись.
   */
  async unblock(id: string, body: unknown, actor: Actor): Promise<RosterRow> {
    const parsed = blockMemberSchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException('Укажите причину разблокировки (3–500 символов)');
    }
    const member = await serializable(
      this.db,
      async (tx) => {
        const existing = await tx.member.findUnique({ where: { id } });
        if (!existing) throw new NotFoundException('Член гильдии не найден');
        if (!existing.blockedAt) throw new ConflictException('Участник не заблокирован');
        const updated = await tx.member.update({
          where: { id },
          data: { blockedAt: null },
        });
        await tx.auditLog.create({
          data: {
            actorMemberId: actor.memberId,
            actorIsAdmin: actor.isAdmin,
            action: 'MEMBER_UNBLOCK',
            entityType: 'Member',
            entityId: id,
            comment: `Участник «${existing.nickname}» разблокирован. ${parsed.data.comment}`,
          },
        });
        return updated;
      },
      true,
    );
    return {
      id: member.id,
      avatar: member.avatar ?? null,
      avatarColor: member.avatarColor ?? null,
      nickname: member.nickname,
      rank: member.rank,
      combatRole: member.combatRole,
      weapons: member.weapons ?? [],
      discord: null,
    };
  }

  private async mustExist(id: string): Promise<MemberRow> {
    const member = await this.db.member.findUnique({ where: { id } });
    if (!member) {
      throw new NotFoundException('Член гильдии не найден');
    }
    return member;
  }

  /** Любое ручное действие обязано писать в аудит (правило 4 AGENTS.md). */
  private async audit(
    actor: Actor,
    action: string,
    entityId: string,
    comment: string,
  ): Promise<void> {
    if (!actor.memberId && !actor.isAdmin) {
      throw new UnauthorizedException('Нет актора для записи в аудит');
    }
    await this.db.auditLog.create({
      data: {
        actorMemberId: actor.memberId,
        actorIsAdmin: actor.isAdmin,
        action,
        entityType: 'Member',
        entityId,
        comment,
      },
    });
  }
}

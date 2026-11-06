import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  changeRankSchema,
  createMemberSchema,
  rosterQuerySchema,
  updateMemberSchema,
  type ChangeRankInput,
  type CreateMemberInput,
  type RosterQuery,
  type UpdateMemberInput,
} from '@dkp/shared';

/** Строка состава для UI. */
export interface RosterRow {
  id: string;
  nickname: string;
  rank: string;
  combatRole: string | null;
  discord: string | null;
}

export interface MemberRow {
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
      action: string;
      entityType: string;
      entityId: string;
      comment?: string;
    };
  }): Promise<unknown>;
}

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface MembersDb {
  member: {
    findMany(args: {
      where: { rank?: string; combatRole?: string };
      orderBy: { nickname: 'asc' };
      include: { user: { select: { username: true } } };
    }): Promise<
      Array<{
        id: string;
        nickname: string;
        rank: string;
        combatRole: string | null;
        user: { username: string } | null;
      }>
    >;
    findUnique(args: { where: { id: string } }): Promise<MemberRow | null>;
    findFirst(args: { where: { nickname: string } }): Promise<{ id: string } | null>;
    count(args: { where: { rank: string } }): Promise<number>;
    create(args: {
      data: { nickname: string; rank: string; combatRole: string | null };
    }): Promise<MemberRow>;
    update(args: {
      where: { id: string };
      data: { nickname?: string; combatRole?: string | null; rank?: string };
    }): Promise<MemberRow>;
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
  constructor(private readonly db: MembersDb) {}

  /** Состав с фильтрами по рангу и роли в бою — всем членам гильдии. */
  async roster(query: unknown): Promise<RosterRow[]> {
    const filters: RosterQuery = rosterQuerySchema.parse(query);
    const where: { rank?: string; combatRole?: string } = {};
    if (filters.rank) {
      where.rank = filters.rank;
    }
    if (filters.combatRole) {
      where.combatRole = filters.combatRole;
    }

    const members = await this.db.member.findMany({
      where,
      orderBy: { nickname: 'asc' },
      include: { user: { select: { username: true } } },
    });
    return members.map((m) => ({
      id: m.id,
      nickname: m.nickname,
      rank: m.rank,
      combatRole: m.combatRole,
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
      nickname: member.nickname,
      rank: member.rank,
      combatRole: member.combatRole,
      discord: null, // имя Discord достаём списком; в карточке не критично
    };
  }

  /** Создание члена (members.manage): до привязки Discord — «пустышка». */
  async create(body: unknown, actor: Actor): Promise<MemberRow> {
    const input: CreateMemberInput = createMemberSchema.parse(body);

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
      },
    });
    await this.audit(actor, 'MEMBER_CREATE', member.id, `Создан член «${member.nickname}»`);
    return member;
  }

  /** Редактирование ника/роли в бою (members.manage). */
  async update(id: string, body: unknown, actor: Actor): Promise<MemberRow> {
    const input: UpdateMemberInput = updateMemberSchema.parse(body);

    const existing = await this.mustExist(id);
    const clash = await this.db.member.findFirst({ where: { nickname: input.nickname } });
    if (clash && clash.id !== id) {
      throw new ConflictException('Член с таким ником уже есть');
    }

    const member = await this.db.member.update({
      where: { id },
      data: { nickname: input.nickname, combatRole: input.combatRole },
    });
    const changes: string[] = [];
    if (existing.nickname !== member.nickname) {
      changes.push(`ник «${existing.nickname}» → «${member.nickname}»`);
    }
    if (existing.combatRole !== member.combatRole) {
      changes.push(
        `роль в бою «${existing.combatRole ?? '—'}» → «${member.combatRole ?? '—'}»`,
      );
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

    if (input.rank === 'ADMIN' || input.rank === 'GUILD_LEADER') {
      throw new ConflictException(
        'Роли «Админ» и «Глава» не назначаются: админ входит только по кредам, глава — единственный',
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
        action,
        entityType: 'Member',
        entityId,
        comment,
      },
    });
  }
}

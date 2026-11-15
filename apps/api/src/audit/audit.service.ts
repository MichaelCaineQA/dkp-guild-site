import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { auditQuerySchema, can, type PermissionActor } from '@dkp/shared';

export interface AuditRecord {
  actorMemberId: string | null;
  actorIsAdmin?: boolean;
  action: string;
  entityType: string;
  entityId: string;
  comment: string;
}

/** Поиск названий по id — общий вид таблиц с полем name. */
interface NameLookup {
  findMany(args: {
    where: { id: { in: string[] } };
    select: { id: true; name: true };
  }): Promise<Array<{ id: string; name: string }>>;
}
interface AuditWhere {
  actorMemberId?: string | null;
  actorIsAdmin?: boolean;
  entityType?: string;
  action?: string;
  createdAt?: { gte?: Date; lte?: Date };
  AND?: Array<{
    OR: Array<{
      actorMemberId?: string;
      entityType?: string;
      entityId?: string | { in: string[] } | { endsWith: string };
    }>;
  }>;
}
export interface AuditDb {
  screenshot: {
    findMany(args: {
      where: { userId: string };
      select: { id: true };
    }): Promise<Array<{ id: string }>>;
  };
  absence: {
    findMany(args: {
      where: { memberId?: string; id?: { in: string[] } };
      select: {
        id: true;
        memberId?: true;
        member?: {
          select: { pack: { select: { leaderId: true; kp: { select: { leaderId: true } } } } };
        };
      };
    }): Promise<
      Array<{
        id: string;
        memberId?: string;
        member?: { pack: { leaderId: string | null; kp: { leaderId: string | null } } | null };
      }>
    >;
  };
  dkpEntry: {
    findMany(args: {
      where: { memberId?: string; id?: { in: string[] } };
      select: { id: true; memberId?: true };
    }): Promise<Array<{ id: string; memberId?: string }>>;
  };
  member: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; nickname: true };
    }): Promise<Array<{ id: string; nickname: string }>>;
  };
  /** Таблицы с человекочитаемым названием (issue #183). */
  kP: NameLookup;
  pack: NameLookup;
  event: NameLookup;
  eventType: NameLookup;
  item: NameLookup;
  guild: NameLookup;
  rulesPage: {
    findMany(args: {
      where: { slug: { in: string[] } };
      select: { slug: true; title: true };
    }): Promise<Array<{ slug: string; title: string }>>;
  };
  user: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; username: true };
    }): Promise<Array<{ id: string; username: string }>>;
  };
  memberLinkRequest: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; nickname: true };
    }): Promise<Array<{ id: string; nickname: string }>>;
  };
  lootDrop: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; item: { select: { name: true } } };
    }): Promise<Array<{ id: string; item: { name: string } }>>;
  };
  auction: {
    findMany(args: {
      where: { id: { in: string[] } };
      select: { id: true; lootDrop: { select: { item: { select: { name: true } } } } };
    }): Promise<Array<{ id: string; lootDrop: { item: { name: string } } | null }>>;
  };
  auditLog: {
    create(args: { data: AuditRecord }): Promise<unknown>;
    count(args: { where: AuditWhere }): Promise<number>;
    findMany(args: {
      where: AuditWhere;
      take: number;
      skip: number;
      orderBy: Array<{ createdAt?: 'desc'; id?: 'desc' }>;
      include: { actor: { select: { nickname: true } } };
    }): Promise<
      Array<
        Omit<AuditRecord, 'comment'> & {
          id: string;
          comment: string | null;
          createdAt: Date;
          actor: { nickname: string } | null;
        }
      >
    >;
    groupBy(args: {
      by: ['action'];
      orderBy: { action: 'asc' };
    }): Promise<Array<{ action: string }>>;
  };
}

@Injectable()
export class AuditService {
  constructor(private readonly db: AuditDb) {}

  record(record: AuditRecord) {
    return this.db.auditLog.create({ data: record });
  }

  async list(query: unknown, actor?: PermissionActor & { userId?: string }) {
    const parsed = auditQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Некорректные фильтры журнала');
    const input = parsed.data;
    const where: AuditWhere = {};
    let personalIds: { absences: string[]; entries: string[]; screenshots: string[] } | null = null;
    if (actor && !can(actor, 'audit.view')) {
      if (!actor.memberId) throw new ForbiddenException('Личный журнал доступен участнику');
      const [absences, entries, screenshots] = await Promise.all([
        this.db.absence.findMany({ where: { memberId: actor.memberId }, select: { id: true } }),
        this.db.dkpEntry.findMany({ where: { memberId: actor.memberId }, select: { id: true } }),
        actor.userId
          ? this.db.screenshot.findMany({ where: { userId: actor.userId }, select: { id: true } })
          : [],
      ]);
      personalIds = {
        absences: absences.map((row) => row.id),
        entries: entries.map((row) => row.id),
        screenshots: screenshots.map((row) => row.id),
      };
      where.AND = [
        {
          OR: [
            { actorMemberId: actor.memberId },
            ...(actor.userId ? [{ entityType: 'User', entityId: actor.userId }] : []),
            { entityType: 'Screenshot', entityId: { in: personalIds.screenshots } },
            { entityType: 'Member', entityId: actor.memberId },
            { entityType: 'Absence', entityId: { in: personalIds.absences } },
            { entityType: 'DkpEntry', entityId: { in: personalIds.entries } },
            { entityType: 'Event', entityId: { in: personalIds.entries } },
            { entityType: 'Event', entityId: { endsWith: `:${actor.memberId}` } },
          ],
        },
      ];
    }
    if (input.entityType) where.entityType = input.entityType;
    if (input.system) {
      where.actorMemberId = null;
      where.actorIsAdmin = false;
    }
    if (input.actorMemberId) where.actorMemberId = input.actorMemberId;
    if (input.action) where.action = input.action;
    if (input.from || input.to) where.createdAt = { gte: input.from, lte: input.to };
    const [entries, total] = await Promise.all([
      this.db.auditLog.findMany({
        where,
        take: input.limit,
        skip: input.offset,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        include: { actor: { select: { nickname: true } } },
      }),
      this.db.auditLog.count({ where }),
    ]);
    const absenceIds = entries
      .filter((entry) => entry.entityType === 'Absence')
      .map((entry) => entry.entityId);
    const dkpIds = entries
      .filter((entry) => entry.entityType === 'DkpEntry' || entry.action === 'MANUAL_DKP')
      .map((entry) => entry.entityId);
    const [affectedAbsences, affectedDkp] = await Promise.all([
      absenceIds.length
        ? this.db.absence.findMany({
            where: { id: { in: absenceIds } },
            select: {
              id: true,
              memberId: true,
              member: {
                select: {
                  pack: { select: { leaderId: true, kp: { select: { leaderId: true } } } },
                },
              },
            },
          })
        : [],
      dkpIds.length
        ? this.db.dkpEntry.findMany({
            where: { id: { in: dkpIds } },
            select: { id: true, memberId: true },
          })
        : [],
    ]);
    const affectedIds = new Map(
      [...affectedAbsences, ...affectedDkp]
        .filter((row) => row.memberId)
        .map((row) => [row.id, row.memberId!]),
    );
    const groupLeaders = new Map(affectedAbsences.map((row) => [row.id, row.member?.pack]));
    const targetOf = (entry: { entityType: string; entityId: string; action: string }) => {
      if (entry.entityType === 'Member') return entry.entityId;
      if (
        entry.entityType === 'Absence' ||
        entry.entityType === 'DkpEntry' ||
        entry.action === 'MANUAL_DKP'
      )
        return affectedIds.get(entry.entityId);
      if (
        entry.entityType === 'Event' &&
        ['MANUAL_ATTENDANCE', 'MANUAL_CHECKIN'].includes(entry.action)
      )
        return entry.entityId.split(':')[1];
      return undefined;
    };
    // Человекочитаемые названия (issue #183): ID сущностей остаются в БД
    // (entityType/entityId), отображению отдаются имена. Собираем id из
    // заголовков записей и cuid-подобных токенов комментариев старых записей.
    const ids = new Set<string>();
    for (const entry of entries) {
      ids.add(entry.entityId.split(':')[0]!);
      if (entry.comment) {
        for (const match of entry.comment.matchAll(/[a-z0-9]{21,32}/g)) ids.add(match[0]);
      }
    }
    const idList = [...ids];
    const names = new Map<string, string>();
    if (idList.length) {
      const where = { id: { in: idList } };
      const [
        kps,
        packs,
        events,
        eventTypes,
        items,
        guilds,
        rulesPages,
        users,
        linkRequests,
        lootDrops,
        auctions,
      ] = await Promise.all([
        this.db.kP.findMany({ where, select: { id: true, name: true } }),
        this.db.pack.findMany({ where, select: { id: true, name: true } }),
        this.db.event.findMany({ where, select: { id: true, name: true } }),
        this.db.eventType.findMany({ where, select: { id: true, name: true } }),
        this.db.item.findMany({ where, select: { id: true, name: true } }),
        this.db.guild.findMany({ where, select: { id: true, name: true } }),
        // У страниц правил первичный ключ — slug, а не id.
        this.db.rulesPage.findMany({
          where: { slug: { in: idList } },
          select: { slug: true, title: true },
        }),
        this.db.user.findMany({ where, select: { id: true, username: true } }),
        this.db.memberLinkRequest.findMany({ where, select: { id: true, nickname: true } }),
        this.db.lootDrop.findMany({
          where,
          select: { id: true, item: { select: { name: true } } },
        }),
        this.db.auction.findMany({
          where,
          select: { id: true, lootDrop: { select: { item: { select: { name: true } } } } },
        }),
      ]);
      for (const row of kps) names.set(row.id, row.name);
      for (const row of packs) names.set(row.id, row.name);
      for (const row of events) names.set(row.id, row.name);
      for (const row of eventTypes) names.set(row.id, row.name);
      for (const row of items) names.set(row.id, row.name);
      for (const row of guilds) names.set(row.id, row.name);
      for (const row of rulesPages) names.set(row.slug, row.title);
      for (const row of users) names.set(row.id, row.username);
      for (const row of linkRequests) names.set(row.id, row.nickname);
      for (const row of lootDrops) names.set(row.id, row.item.name);
      for (const row of auctions) if (row.lootDrop) names.set(row.id, row.lootDrop.item.name);
    }
    const memberIds = [
      ...new Set([...entries.map(targetOf).filter((id): id is string => !!id), ...idList]),
    ];
    const members = memberIds.length
      ? await this.db.member.findMany({
          where: { id: { in: memberIds } },
          select: { id: true, nickname: true },
        })
      : [];
    const memberNames = new Map(members.map((member) => [member.id, member.nickname]));
    for (const member of members) names.set(member.id, member.nickname);
    /** Известные id в комментариях показываются именами («Альфа» вместо cuid). */
    const readableComment = (comment: string | null) => {
      if (!comment || names.size === 0) return comment;
      return comment.replace(/\b[a-z0-9]{21,32}\b/g, (token) => {
        const name = names.get(token);
        return name ? `«${name}»` : token;
      });
    };
    return {
      entries: entries.map(({ actor: author, ...entry }) => {
        const safeDetails =
          !personalIds ||
          (entry.entityType === 'Member' && entry.entityId === actor?.memberId) ||
          (entry.entityType === 'Absence' && personalIds.absences.includes(entry.entityId)) ||
          (entry.entityType === 'Screenshot' && personalIds.screenshots.includes(entry.entityId)) ||
          ((entry.entityType === 'DkpEntry' || entry.entityType === 'Event') &&
            personalIds.entries.includes(entry.entityId)) ||
          (entry.entityType === 'Event' && entry.entityId.endsWith(`:${actor?.memberId}`));
        const hideAbsenceComment =
          entry.entityType === 'Absence' &&
          !!actor &&
          !actor.isAdmin &&
          actor.rank !== 'ADMIN' &&
          actor.rank !== 'GUILD_LEADER' &&
          affectedIds.get(entry.entityId) !== actor.memberId &&
          (!actor.memberId ||
            (groupLeaders.get(entry.entityId)?.leaderId !== actor.memberId &&
              groupLeaders.get(entry.entityId)?.kp.leaderId !== actor.memberId));
        return {
          ...entry,
          ...(safeDetails
            ? { comment: hideAbsenceComment ? null : readableComment(entry.comment) }
            : { comment: null, entityId: '' }),
          actorName: author?.nickname ?? (entry.actorIsAdmin ? 'Админ' : null),
          entityName: !safeDetails
            ? null
            : targetOf(entry)
              ? (memberNames.get(targetOf(entry)!) ?? 'Участник недоступен')
              : (names.get(entry.entityId) ?? null),
        };
      }),
      total,
    };
  }

  async actions() {
    return (await this.db.auditLog.groupBy({ by: ['action'], orderBy: { action: 'asc' } })).map(
      (row) => row.action,
    );
  }
}

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
      select: { id: true; memberId?: true };
    }): Promise<Array<{ id: string; memberId?: string }>>;
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
            select: { id: true, memberId: true },
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
    const memberIds = [...new Set(entries.map(targetOf).filter((id): id is string => !!id))];
    const members = memberIds.length
      ? await this.db.member.findMany({
          where: { id: { in: memberIds } },
          select: { id: true, nickname: true },
        })
      : [];
    const memberNames = new Map(members.map((member) => [member.id, member.nickname]));
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
        return {
          ...entry,
          ...(safeDetails ? {} : { comment: null, entityId: '' }),
          actorName: author?.nickname ?? (entry.actorIsAdmin ? 'Админ' : null),
          entityName:
            safeDetails && targetOf(entry)
              ? (memberNames.get(targetOf(entry)!) ?? 'Участник недоступен')
              : null,
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

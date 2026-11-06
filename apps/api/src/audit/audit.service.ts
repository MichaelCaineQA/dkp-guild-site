import { BadRequestException, Injectable } from '@nestjs/common';
import { auditQuerySchema } from '@dkp/shared';

export interface AuditRecord {
  actorMemberId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  comment: string;
}
interface AuditWhere {
  actorMemberId?: string;
  action?: string;
  createdAt?: { gte?: Date; lte?: Date };
}
export interface AuditDb {
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

  async list(query: unknown) {
    const parsed = auditQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Некорректные фильтры журнала');
    const input = parsed.data;
    const where: AuditWhere = {};
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
    return {
      entries: entries.map(({ actor, ...entry }) => ({
        ...entry,
        actorName: actor?.nickname ?? null,
      })),
      total,
    };
  }

  async actions() {
    return (await this.db.auditLog.groupBy({ by: ['action'], orderBy: { action: 'asc' } })).map(
      (row) => row.action,
    );
  }
}

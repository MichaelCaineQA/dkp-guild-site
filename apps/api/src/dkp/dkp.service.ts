import { Injectable, NotFoundException } from '@nestjs/common';
import { computeBalance, dkpQuerySchema, type DkpBalanceRow, type DkpEntryRow, type DkpQuery } from '@dkp/shared';

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface DkpDb {
  member: {
    findMany(args?: unknown): Promise<Array<{ id: string; nickname: string }>>;
    findUnique(args: { where: { id: string } }): Promise<{ id: string; nickname: string } | null>;
  };
  dkpEntry: {
    findMany(args: {
      where: {
        memberId?: string;
        eventId?: string;
        type?: string;
        createdAt?: { gte?: Date; lte?: Date };
      };
      orderBy: { createdAt: 'desc' };
      take: number;
      skip: number;
    }): Promise<
      Array<{
        id: string;
        memberId: string;
        type: string;
        amount: number;
        comment: string | null;
        eventId: string | null;
        createdAt: Date;
      }>
    >;
    count(args: { where: Record<string, unknown> }): Promise<number>;
  };
}

/**
 * Журнал ДКП (issue #12, план 2.2): только чтение и только добавление
 * записей (append). Записи создают модули-источники (чек-ин, проведение,
 * аукцион); update/delete-путей здесь нет принципиально — «исправление»
 * это новая запись ADJUSTMENT. Публично всем членам гильдии (решение №4).
 */
@Injectable()
export class DkpService {
  // Сознательное отсутствие update/delete — гарантия append-only
  // (правило 1 AGENTS.md); фиксируется отдельным тестом.

  constructor(private readonly db: DkpDb) {}

  /** Операции с фильтрами (игрок/ивент/тип/период) и пагинацией. */
  async list(query: unknown): Promise<{ entries: DkpEntryRow[]; total: number }> {
    const filters: DkpQuery = dkpQuerySchema.parse(query);
    const where = this.whereOf(filters);

    const [rows, total] = await Promise.all([
      this.db.dkpEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: filters.limit,
        skip: filters.offset,
      }),
      this.db.dkpEntry.count({ where }),
    ]);

    const members = await this.db.member.findMany();
    const nameOf = new Map(members.map((m) => [m.id, m.nickname]));

    return {
      total,
      entries: rows.map((row) => ({
        id: row.id,
        memberId: row.memberId,
        memberName: nameOf.get(row.memberId) ?? 'неизвестный',
        type: row.type,
        amount: row.amount,
        comment: row.comment,
        eventId: row.eventId,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Балансы всех членов (план 2.8, для страницы журнала и состава):
   * баланс = сумма журнала (computeBalance), включая ушедших в минус.
   */
  async balances(): Promise<DkpBalanceRow[]> {
    const [members, entries] = await Promise.all([
      this.db.member.findMany(),
      this.db.dkpEntry.findMany({
        where: {},
        orderBy: { createdAt: 'desc' },
        take: 10_000, // защитный потолок; журналы гильдии далеки от него
        skip: 0,
      }),
    ]);
    return members
      .map((member) => ({
        memberId: member.id,
        memberName: member.nickname,
        balance: computeBalance(entries.filter((e) => e.memberId === member.id)),
      }))
      .sort((a, b) => b.balance - a.balance || a.memberName.localeCompare(b.memberName));
  }

  /** Баланс одного игрока: любая цифра раскрывается до цепочки операций. */
  async memberBalance(memberId: string): Promise<DkpBalanceRow> {
    const member = await this.db.member.findUnique({ where: { id: memberId } });
    if (!member) {
      throw new NotFoundException('Член гильдии не найден');
    }
    const entries = await this.db.dkpEntry.findMany({
      where: { memberId },
      orderBy: { createdAt: 'desc' },
      take: 10_000,
      skip: 0,
    });
    return {
      memberId,
      memberName: member.nickname,
      balance: computeBalance(entries),
    };
  }

  private whereOf(filters: DkpQuery) {
    const where: {
      memberId?: string;
      eventId?: string;
      type?: string;
      createdAt?: { gte?: Date; lte?: Date };
    } = {};
    if (filters.memberId) {
      where.memberId = filters.memberId;
    }
    if (filters.eventId) {
      where.eventId = filters.eventId;
    }
    if (filters.type) {
      where.type = filters.type;
    }
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      };
    }
    return where;
  }
}

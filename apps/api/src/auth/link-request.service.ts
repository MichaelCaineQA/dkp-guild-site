import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { createLinkRequestSchema, type CreateLinkRequestInput } from '@dkp/shared';

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface LinkRequestDb {
  user: {
    findUnique(args: {
      where: { id: string };
      include: { member: { select: { id: true } } };
    }): Promise<{ id: string; member: { id: string } | null } | null>;
  };
  member: {
    /** Member с таким игровым ником (ник уникален логически; уникальность в БД — задача #6). */
    findFirst(args: { where: { nickname: string } }): Promise<{ id: string; userId: string | null } | null>;
    update(args: { where: { id: string }; data: { userId: string | null } }): Promise<unknown>;
    create(args: { data: { nickname: string; userId: string } }): Promise<{ id: string }>;
  };
  memberLinkRequest: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      userId: string;
      nickname: string;
      status: string;
    } | null>;
    create(args: { data: { userId: string; nickname: string } }): Promise<unknown>;
    update(args: {
      where: { id: string };
      data: { status: string; resolvedAt: Date };
    }): Promise<unknown>;
    findMany(args: {
      where: { status: string };
      include: { user: { select: { username: boolean } } };
    }): Promise<
      Array<{
        id: string;
        nickname: string;
        createdAt: Date;
        user: { username: string };
      }>
    >;
  };
}

/**
 * Заявки на привязку Discord ↔ Member (план 2.9): вошедший без Member
 * указывает игровой ник, офицер подтверждает (защита от чужих).
 */
@Injectable()
export class LinkRequestService {
  constructor(private readonly db: LinkRequestDb) {}

  async create(userId: string, body: unknown) {
    const input: CreateLinkRequestInput = createLinkRequestSchema.parse(body);

    const user = await this.db.user.findUnique({
      where: { id: userId },
      include: { member: { select: { id: true } } },
    });
    if (!user) {
      throw new UnauthorizedException();
    }
    if (user.member) {
      throw new UnauthorizedException('Аккаунт уже привязан к члену гильдии');
    }

    await this.db.memberLinkRequest.create({ data: { userId, nickname: input.nickname } });
    return { ok: true };
  }

  async listPending() {
    return this.db.memberLinkRequest.findMany({
      where: { status: 'PENDING' },
      include: { user: { select: { username: true } } },
    });
  }

  /**
   * Одобрить: Member с таким ником может быть уже заведён офицерами — тогда
   * привязываем аккаунт к нему; иначе создаём нового Member с этим ником.
   */
  async approve(id: string) {
    const request = await this.mustBePending(id);

    const user = await this.db.user.findUnique({
      where: { id: request.userId },
      include: { member: { select: { id: true } } },
    });
    if (!user || user.member) {
      throw new UnauthorizedException('Аккаунт уже привязан');
    }

    const existing = await this.db.member.findFirst({ where: { nickname: request.nickname } });
    if (existing) {
      if (existing.userId) {
        throw new UnauthorizedException('Этот ник уже привязан к другому аккаунту');
      }
      await this.db.member.update({
        where: { id: existing.id },
        data: { userId: request.userId },
      });
    } else {
      await this.db.member.create({ data: { nickname: request.nickname, userId: request.userId } });
    }

    await this.db.memberLinkRequest.update({
      where: { id },
      data: { status: 'APPROVED', resolvedAt: new Date() },
    });
    return { ok: true };
  }

  async reject(id: string) {
    await this.mustBePending(id);
    await this.db.memberLinkRequest.update({
      where: { id },
      data: { status: 'REJECTED', resolvedAt: new Date() },
    });
    return { ok: true };
  }

  private async mustBePending(id: string) {
    const request = await this.db.memberLinkRequest.findUnique({ where: { id } });
    if (!request || request.status !== 'PENDING') {
      throw new NotFoundException('Заявка не найдена или уже обработана');
    }
    return request;
  }
}

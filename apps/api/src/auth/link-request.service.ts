import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createLinkRequestSchema, type CombatRole, type Weapon } from '@dkp/shared';

/** Минимальный интерфейс БД — для юнит-тестов без Prisma. */
export interface LinkRequestDb {
  user: {
    findUnique(args: {
      where: { id: string };
      include: { member: { select: { id: true } } };
    }): Promise<{ id: string; member: { id: string } | null } | null>;
  };
  member: {
    /** Member с таким игровым ником (ник уникален в БД с миграции задачи #6). */
    findFirst(args: {
      where: { nickname: string };
    }): Promise<{ id: string; userId: string | null } | null>;
    update(args: {
      where: { id: string };
      data: { userId: string | null; combatRole: CombatRole; weapons: Weapon[] };
    }): Promise<unknown>;
    create(args: {
      data: { nickname: string; userId: string; combatRole: CombatRole; weapons: Weapon[] };
    }): Promise<{ id: string }>;
  };
  memberLinkRequest: {
    findUnique(args: { where: { id: string } }): Promise<{
      id: string;
      userId: string;
      nickname: string;
      status: string;
      combatRole?: CombatRole | null;
      weapons?: Weapon[];
    } | null>;
    upsert(args: {
      where: { userId_nickname: { userId: string; nickname: string } };
      create: { userId: string; nickname: string; combatRole: CombatRole; weapons: Weapon[] };
      update: {
        combatRole: CombatRole;
        weapons: Weapon[];
        status: string;
        resolvedAt: null;
        resolvedById: null;
      };
    }): Promise<unknown>;
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
    const parsed = createLinkRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Укажите ник, роль и два разных оружия');
    const input = parsed.data;

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

    await this.db.memberLinkRequest.upsert({
      where: { userId_nickname: { userId, nickname: input.nickname } },
      create: { userId, ...input },
      update: {
        combatRole: input.combatRole,
        weapons: input.weapons,
        status: 'PENDING',
        resolvedAt: null,
        resolvedById: null,
      },
    });
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
    const parsed = createLinkRequestSchema.safeParse(request);
    if (!parsed.success)
      throw new ConflictException(
        'В старой заявке не указаны роль и оружия. Отклоните её и попросите игрока подать новую.',
      );
    const { combatRole, weapons } = parsed.data;

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
        data: { userId: request.userId, combatRole, weapons },
      });
    } else {
      await this.db.member.create({
        data: { nickname: request.nickname, userId: request.userId, combatRole, weapons },
      });
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

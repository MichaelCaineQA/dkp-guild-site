import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { rulesSlugSchema, updateRulesSchema, restoreRulesSchema } from '@dkp/shared';

interface PageRow {
  slug: string;
  title: string;
  contentMd: string;
  version: number;
  updatedAt: Date;
}
interface VersionRow {
  pageSlug: string;
  version: number;
  contentMd: string;
  createdAt: Date;
}
export interface RulesTransaction {
  rulesPage: {
    findUnique(args: { where: { slug: string } }): Promise<PageRow | null>;
    updateMany(args: {
      where: { slug: string; version: number };
      data: { contentMd: string; version: number };
    }): Promise<{ count: number }>;
  };
  rulesPageVersion: {
    findUnique(args: {
      where: { pageSlug_version: { pageSlug: string; version: number } };
    }): Promise<VersionRow | null>;
    upsert(args: {
      where: { pageSlug_version: { pageSlug: string; version: number } };
      create: { pageSlug: string; contentMd: string; version: number; createdAt: Date };
      update: object;
    }): Promise<unknown>;
    create(args: {
      data: { pageSlug: string; contentMd: string; version: number };
    }): Promise<unknown>;
    findMany(args: {
      where: { pageSlug: string };
      orderBy: { version: 'desc' };
      select: { version: true; createdAt: true };
    }): Promise<Array<{ version: number; createdAt: Date }>>;
  };
  auditLog: {
    create(args: {
      data: {
        actorMemberId: string | null;
        actorIsAdmin?: boolean;
        action: string;
        entityType: string;
        entityId: string;
        comment: string;
      };
    }): Promise<unknown>;
  };
}
export interface RulesDb extends RulesTransaction {
  $transaction<T>(work: (tx: RulesTransaction) => Promise<T>): Promise<T>;
}
export interface RulesActor {
  memberId: string | null;
  userId: string;
  isAdmin?: boolean;
}

@Injectable()
export class RulesService {
  constructor(private readonly db: RulesDb) {}
  async get(slug: string) {
    return this.mustExist(this.db, slug);
  }
  async history(slug: string) {
    await this.mustExist(this.db, slug);
    return this.db.rulesPageVersion.findMany({
      where: { pageSlug: slug },
      orderBy: { version: 'desc' },
      select: { version: true, createdAt: true },
    });
  }
  async version(slug: string, value: string) {
    await this.mustExist(this.db, slug);
    const version = Number(value);
    if (!Number.isSafeInteger(version) || version <= 0)
      throw new BadRequestException('Некорректный номер версии');
    return this.mustExistVersion(this.db, slug, version);
  }
  async update(slug: string, body: unknown, actor: RulesActor) {
    const parsed = updateRulesSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Проверьте текст правил, версию и комментарий');
    return this.db.$transaction((tx) => this.publish(tx, slug, parsed.data, actor));
  }
  async restore(slug: string, body: unknown, actor: RulesActor) {
    const parsed = restoreRulesSchema.safeParse(body);
    if (!parsed.success)
      throw new BadRequestException('Укажите исходную версию, текущую версию и комментарий');
    const input = parsed.data;
    return this.db.$transaction(async (tx) => {
      await this.mustExist(tx, slug);
      const source = await this.mustExistVersion(tx, slug, input.sourceVersion);
      return this.publish(
        tx,
        slug,
        { ...input, contentMd: source.contentMd },
        actor,
        input.sourceVersion,
      );
    });
  }
  private async publish(
    tx: RulesTransaction,
    slug: string,
    input: { contentMd: string; expectedVersion: number; comment: string },
    actor: RulesActor,
    restoredFrom?: number,
  ) {
    const current = await this.mustExist(tx, slug);
    if (current.version !== input.expectedVersion)
      throw new ConflictException(
        'Правила уже изменились. Загрузите актуальную версию перед сохранением.',
      );
    if (restoredFrom === current.version)
      throw new ConflictException('Эта версия уже опубликована');
    const nextVersion = current.version + 1;
    // Поддерживает и старые страницы, созданные до появления истории.
    await tx.rulesPageVersion.upsert({
      where: { pageSlug_version: { pageSlug: slug, version: current.version } },
      create: {
        pageSlug: slug,
        version: current.version,
        contentMd: current.contentMd,
        createdAt: current.updatedAt,
      },
      update: {},
    });
    const updated = await tx.rulesPage.updateMany({
      where: { slug, version: input.expectedVersion },
      data: { contentMd: input.contentMd, version: nextVersion },
    });
    if (updated.count !== 1)
      throw new ConflictException(
        'Правила уже изменились. Загрузите актуальную версию перед сохранением.',
      );
    await tx.rulesPageVersion.create({
      data: { pageSlug: slug, version: nextVersion, contentMd: input.contentMd },
    });
    await tx.auditLog.create({
      data: {
        actorMemberId: actor.memberId,
        actorIsAdmin: actor.isAdmin,
        action: restoredFrom === undefined ? 'RULES_UPDATE' : 'RULES_RESTORE',
        entityType: 'RulesPage',
        entityId: slug,
        comment: `${actor.userId}: версия ${current.version} → ${nextVersion}${restoredFrom === undefined ? '' : `, восстановлена версия ${restoredFrom}`}. ${input.comment}`,
      },
    });
    return this.mustExist(tx, slug);
  }
  private async mustExist(db: RulesTransaction, slug: string) {
    if (!rulesSlugSchema.safeParse(slug).success)
      throw new NotFoundException('Страница правил не найдена');
    const page = await db.rulesPage.findUnique({ where: { slug } });
    if (!page) throw new NotFoundException('Страница правил не найдена');
    return page;
  }
  private async mustExistVersion(db: RulesTransaction, slug: string, version: number) {
    const found = await db.rulesPageVersion.findUnique({
      where: { pageSlug_version: { pageSlug: slug, version } },
    });
    if (!found) throw new NotFoundException('Версия правил не найдена');
    return found;
  }
}

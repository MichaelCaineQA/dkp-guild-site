import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import type { SessionUser } from '@dkp/shared';
import { RulesController } from './rules.controller';
import { RulesService, type RulesDb, type RulesTransaction } from './rules.service';

const initial = {
  slug: 'guild-rules',
  title: 'Правила гильдии',
  contentMd: '# Первая версия',
  version: 1,
  updatedAt: new Date('2026-11-01T12:00:00Z'),
};
type PageRow = typeof initial;
interface HistoryRow {
  pageSlug: string;
  version: number;
  contentMd: string;
  createdAt: Date;
}
let page: PageRow;
let versions: Map<number, HistoryRow>;
let audit: unknown[];
let failAudit: boolean;
let failCompare: boolean;
let actor: SessionUser | undefined;
function transaction(draft: {
  page: PageRow;
  versions: Map<number, HistoryRow>;
  audit: unknown[];
}): RulesTransaction {
  return {
    rulesPage: {
      findUnique: async ({ where }) => (where.slug === draft.page.slug ? { ...draft.page } : null),
      updateMany: async ({ where, data }) => {
        if (failCompare || where.version !== draft.page.version) return { count: 0 };
        draft.page = { ...draft.page, ...data, updatedAt: new Date() };
        return { count: 1 };
      },
    },
    rulesPageVersion: {
      findUnique: async ({ where }) => draft.versions.get(where.pageSlug_version.version) ?? null,
      findMany: async () => [...draft.versions.values()].sort((a, b) => b.version - a.version),
      upsert: async ({ create }) => {
        if (!draft.versions.has(create.version)) draft.versions.set(create.version, { ...create });
        return {};
      },
      create: async ({ data }) => {
        draft.versions.set(data.version, { ...data, createdAt: new Date() });
        return {};
      },
    },
    auditLog: {
      create: async ({ data }) => {
        if (failAudit) throw new Error('Аудит недоступен');
        draft.audit.push(data);
        return {};
      },
    },
  };
}
const db: RulesDb = {
  rulesPage: {
    findUnique: async ({ where }) => (where.slug === page.slug ? { ...page } : null),
    updateMany: async () => {
      throw new Error('Вне транзакции');
    },
  },
  rulesPageVersion: {
    findUnique: async ({ where }) => versions.get(where.pageSlug_version.version) ?? null,
    findMany: async () => [...versions.values()].sort((a, b) => b.version - a.version),
    upsert: async () => {
      throw new Error('Вне транзакции');
    },
    create: async () => {
      throw new Error('Вне транзакции');
    },
  },
  auditLog: {
    create: async () => {
      throw new Error('Вне транзакции');
    },
  },
  $transaction: async (work) => {
    const draft = { page: { ...page }, versions: new Map(versions), audit: [...audit] };
    const result = await work(transaction(draft));
    page = draft.page;
    versions = draft.versions;
    audit = draft.audit;
    return result;
  },
};
@Module({
  controllers: [RulesController],
  providers: [{ provide: RulesService, useValue: new RulesService(db) }],
})
class TestModule {}

describe('правила через HTTP', () => {
  let app: INestApplication;
  let url: string;
  beforeAll(async () => {
    app = await NestFactory.create(TestModule, { logger: false });
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, { session: { user: actor } });
      next();
    });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    page = { ...initial };
    versions = new Map([
      [
        1,
        { pageSlug: page.slug, version: 1, contentMd: page.contentMd, createdAt: page.updatedAt },
      ],
    ]);
    audit = [];
    failAudit = false;
    failCompare = false;
    actor = {
      userId: 'u1',
      username: 'Глава',
      memberId: 'm1',
      rank: 'GUILD_LEADER',
      isAdmin: false,
    };
  });
  const update = (body: unknown) =>
    fetch(`${url}/rules/guild-rules`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const restore = (body: unknown) =>
    fetch(`${url}/rules/guild-rules/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  const body = { contentMd: '# Новые правила ✅', expectedVersion: 1, comment: 'Уточнение текста' };

  it('аноним — 401, непривязанный — 403; рядовой читает, но не правит', async () => {
    actor = undefined;
    expect((await fetch(`${url}/rules/guild-rules`)).status).toBe(401);
    actor = { userId: 'u2', username: 'Новый', memberId: null, rank: null, isAdmin: false };
    expect((await fetch(`${url}/rules/guild-rules`)).status).toBe(403);
    actor.memberId = 'm2';
    actor.rank = 'MEMBER';
    expect((await fetch(`${url}/rules/guild-rules`)).status).toBe(200);
    expect((await update(body)).status).toBe(403);
  });

  it('офицер читает историю, но публикация и восстановление запрещены', async () => {
    actor!.rank = 'OFFICER';
    expect((await fetch(`${url}/rules/guild-rules/versions`)).status).toBe(200);
    expect((await update(body)).status).toBe(403);
    expect(
      (await restore({ sourceVersion: 1, expectedVersion: 1, comment: 'Возврат' })).status,
    ).toBe(403);
    expect(audit).toHaveLength(0);
  });

  it('сохранение создаёт версию и одну запись аудита, старый текст доступен', async () => {
    expect((await update(body)).status).toBe(200);
    expect(page.version).toBe(2);
    expect(page.contentMd).toBe(body.contentMd);
    expect(versions.get(1)?.contentMd).toBe(initial.contentMd);
    expect(versions.get(2)?.contentMd).toBe(body.contentMd);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'RULES_UPDATE',
      actorMemberId: 'm1',
      entityId: 'guild-rules',
      comment: expect.stringContaining(body.comment),
    });
    expect(await (await fetch(`${url}/rules/guild-rules/versions/1`)).json()).toMatchObject({
      contentMd: initial.contentMd,
    });
  });

  it('восстановление создаёт третью версию, не затирая вторую', async () => {
    await update(body);
    expect(
      (await restore({ sourceVersion: 1, expectedVersion: 2, comment: 'Возвращаем прежний текст' }))
        .status,
    ).toBe(201);
    expect(page.version).toBe(3);
    expect(page.contentMd).toBe(initial.contentMd);
    expect(versions.get(2)?.contentMd).toBe(body.contentMd);
    expect(versions.get(3)?.contentMd).toBe(initial.contentMd);
    expect(audit).toHaveLength(2);
    expect(audit[1]).toMatchObject({ action: 'RULES_RESTORE' });
  });

  it('резервный админ публикует без Member, личность остаётся в аудите', async () => {
    actor = { userId: 'admin:admin', username: 'admin', memberId: null, rank: null, isAdmin: true };
    expect((await update(body)).status).toBe(200);
    expect(audit[0]).toMatchObject({
      actorMemberId: null,
      comment: expect.stringContaining('admin:admin'),
    });
  });

  it('устаревшая версия и проигранная гонка записи — 409 без изменений', async () => {
    expect((await update({ ...body, expectedVersion: 2 })).status).toBe(409);
    failCompare = true;
    expect((await update(body)).status).toBe(409);
    expect(page.version).toBe(1);
    expect(versions.size).toBe(1);
    expect(audit).toHaveLength(0);
  });

  it('ошибка аудита откатывает текст, версию и снимок истории', async () => {
    failAudit = true;
    expect((await update(body)).status).toBe(500);
    expect(page).toEqual(initial);
    expect(versions.size).toBe(1);
    expect(audit).toHaveLength(0);
  });

  it('неверные slug, номер и исходная версия не проходят', async () => {
    expect((await fetch(`${url}/rules/other`)).status).toBe(404);
    expect((await fetch(`${url}/rules/guild-rules/versions/wrong`)).status).toBe(400);
    expect(
      (await restore({ sourceVersion: 99, expectedVersion: 1, comment: 'Возврат' })).status,
    ).toBe(404);
  });

  it('пустой текст, комментарий и лишние поля — 400', async () => {
    for (const input of [
      { ...body, contentMd: ' ' },
      { ...body, comment: ' ' },
      { ...body, version: 10 },
    ])
      expect((await update(input)).status).toBe(400);
    expect(page.version).toBe(1);
    expect(audit).toHaveLength(0);
  });
});

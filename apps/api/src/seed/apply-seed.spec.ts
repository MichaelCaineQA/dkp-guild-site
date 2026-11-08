import { applySeed, type SeedDb } from './apply-seed';
import { EVENT_TYPE_NAMES, SEED_SETTINGS } from './seed-data';

interface FakeDbState {
  rules: Map<string, { slug: string; contentMd: string; version: number; updatedAt: Date }>;
  versions: Map<string, string>;
  guilds: { id: string; data?: unknown }[];
  eventTypes: Map<string, number>;
  settings: Map<string, number>;
}

function makeFakeDb(): { db: SeedDb; state: FakeDbState } {
  const state: FakeDbState = {
    rules: new Map(),
    versions: new Map(),
    guilds: [],
    eventTypes: new Map(),
    settings: new Map(),
  };

  const db: SeedDb = {
    rulesPage: {
      upsert: async ({ where, create }) => {
        if (!state.rules.has(where.slug))
          state.rules.set(where.slug, {
            slug: create.slug,
            contentMd: create.contentMd,
            version: 1,
            updatedAt: new Date(),
          });
        return state.rules.get(where.slug)!;
      },
    },
    rulesPageVersion: {
      upsert: async ({ create }) => {
        const key = `${create.pageSlug}:${create.version}`;
        if (!state.versions.has(key)) state.versions.set(key, create.contentMd);
        return {};
      },
    },
    guild: {
      findFirst: async () => state.guilds[0] ?? null,
      create: async ({ data }) => {
        const guild = { id: 'guild-1', data };
        state.guilds.push(guild);
        return guild;
      },
    },
    eventType: {
      upsert: async ({ where, create }) => {
        state.eventTypes.set(where.name, (state.eventTypes.get(where.name) ?? 0) + 1);
        return { name: create.name };
      },
    },
    setting: {
      create: async ({ data }) => {
        if (state.settings.has(data.key)) {
          const error = new Error('Unique constraint failed') as Error & { code?: string };
          error.code = 'P2002';
          throw error;
        }
        state.settings.set(data.key, data.value);
        return data;
      },
    },
  };

  return { db, state };
}

describe('applySeed (идемпотентность)', () => {
  it('использует имя при создании и не меняет его при повторной инициализации', async () => {
    const { db, state } = makeFakeDb();
    await applySeed(db, '  Новая гильдия  ');
    await applySeed(db, 'Другое имя');
    expect(state.guilds).toHaveLength(1);
    expect(state.guilds[0].data).toMatchObject({ name: 'Новая гильдия' });
  });
  it('отклоняет пустое начальное имя до создания гильдии', async () => {
    const { db, state } = makeFakeDb();
    await expect(applySeed(db, '  ')).rejects.toThrow('Название гильдии');
    expect(state.guilds).toHaveLength(0);
  });
  it('создаёт две страницы и историю, повторный seed не затирает публикации', async () => {
    const { db, state } = makeFakeDb();
    await applySeed(db);
    expect(state.rules.size).toBe(2);
    expect(state.versions.size).toBe(2);
    state.rules.get('guild-rules')!.contentMd = 'Опубликованные правила';
    await applySeed(db);
    expect(state.rules.get('guild-rules')!.contentMd).toBe('Опубликованные правила');
    expect(state.versions.size).toBe(2);
  });
  it('первый прогон создаёт гильдию, все типы ивентов и все настройки', async () => {
    const { db, state } = makeFakeDb();
    const result = await applySeed(db);

    expect(state.guilds).toHaveLength(1);
    expect(state.eventTypes.size).toBe(EVENT_TYPE_NAMES.length);
    expect(state.settings.size).toBe(SEED_SETTINGS.length);
    expect(result.createdSettings).toBe(SEED_SETTINGS.length);
  });

  it('повторный прогон ничего не дублирует и не перетирает настройки', async () => {
    const { db, state } = makeFakeDb();
    await applySeed(db);

    // кто-то поменял настройку руками — seed не должен её затереть
    state.settings.set('checkin.windowSec', 999);

    const result = await applySeed(db);

    expect(state.guilds).toHaveLength(1);
    expect(state.eventTypes.size).toBe(EVENT_TYPE_NAMES.length);
    expect(result.createdSettings).toBe(0);
    expect(state.settings.get('checkin.windowSec')).toBe(999);
  });

  it('чужая ошибка БД (не P2002) пробрасывается', async () => {
    const { db } = makeFakeDb();
    db.setting.create = async () => {
      throw new Error('connection reset');
    };
    await expect(applySeed(db)).rejects.toThrow('connection reset');
  });
});

describe('seed-data', () => {
  it('ключи настроек уникальны', () => {
    const keys = SEED_SETTINGS.map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

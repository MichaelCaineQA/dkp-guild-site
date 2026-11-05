import { applySeed, type SeedDb } from './apply-seed';
import { EVENT_TYPE_NAMES, SEED_SETTINGS } from './seed-data';

interface FakeDbState {
  guilds: { id: string; data?: unknown }[];
  eventTypes: Map<string, number>;
  settings: Map<string, number>;
}

function makeFakeDb(): { db: SeedDb; state: FakeDbState } {
  const state: FakeDbState = {
    guilds: [],
    eventTypes: new Map(),
    settings: new Map(),
  };

  const db: SeedDb = {
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

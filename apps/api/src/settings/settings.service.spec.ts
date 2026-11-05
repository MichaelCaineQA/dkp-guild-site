import type { SettingsDb, SettingsActor } from './settings.service';
import { SettingsService, settingsMetadata } from './settings.service';
import { SETTING_DEFAULTS } from '@dkp/shared';

const ACTOR: SettingsActor = { memberId: 'm-actor', isAdmin: false };

function makeDb(stored: Record<string, number> = {}) {
  const state = new Map(Object.entries(stored));
  const audit: Array<Record<string, string | null>> = [];
  const db: SettingsDb = {
    setting: {
      findMany: async () => Array.from(state, ([key, value]) => ({ key, value })),
      upsert: async ({ where, create, update }) => {
        if (state.has(where.key)) {
          state.set(where.key, update.value);
        } else {
          state.set(create.key, create.value);
        }
        return {};
      },
    },
    guild: {
      findFirst: async () => ({
        id: 'g1',
        gameTimeAnchor: new Date('2026-01-01T00:00:00Z'),
        gameTimeDayMinutes: 90,
        gameTimeNightMinutes: 30,
      }),
      update: async ({ where, data }) => ({
        id: where.id,
        gameTimeAnchor: data.gameTimeAnchor ?? new Date('2026-01-01T00:00:00Z'),
        gameTimeDayMinutes: data.gameTimeDayMinutes ?? 90,
        gameTimeNightMinutes: data.gameTimeNightMinutes ?? 30,
      }),
    },
    auditLog: {
      create: async ({ data }) => {
        audit.push(data);
      },
    },
  };
  return { db, state, audit };
}

describe('SettingsService.getAll', () => {
  it('возвращает дефолты для отсутствующих и значения из БД', async () => {
    const { db } = makeDb({ 'auction.step': 5 });
    const service = new SettingsService(db);

    const all = await service.getAll();
    expect(all['auction.step']).toBe(5);
    expect(all['checkin.windowSec']).toBe(SETTING_DEFAULTS['checkin.windowSec']);
    expect(Object.keys(all)).toHaveLength(13);
  });
});

describe('SettingsService.update', () => {
  it('записывает валидные значения и пишет аудит с изменениями', async () => {
    const { db, audit } = makeDb();
    const service = new SettingsService(db);

    const updated = await service.update({ 'auction.step': 3, 'checkin.windowSec': 240 }, ACTOR);
    expect(updated['auction.step']).toBe(3);
    expect(updated['checkin.windowSec']).toBe(240);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ action: 'SETTINGS_UPDATE', entityType: 'Setting' });
    expect(audit[0]!.comment).toContain('auction.step: 1 → 3');
    expect(audit[0]!.comment).toContain('checkin.windowSec: 180 → 240');
  });

  it('неизменённые значения не пишутся и не шумят в аудите', async () => {
    const { db, audit } = makeDb({ 'auction.step': 2 });
    const service = new SettingsService(db);

    await service.update({ 'auction.step': 2 }, ACTOR);
    expect(audit).toHaveLength(0);
  });

  it('невалидное значение — zod-ошибка, ничего не пишется', async () => {
    const { db, audit } = makeDb();
    const service = new SettingsService(db);

    await expect(service.update({ 'auction.step': 0 }, ACTOR)).rejects.toThrow();
    await expect(service.update({ 'unknown.key': 1 }, ACTOR)).rejects.toThrow();
    expect(audit).toHaveLength(0);
  });
});

describe('SettingsService.gameTime', () => {
  it('читает игровой цикл из гильдии', async () => {
    const { db } = makeDb();
    const service = new SettingsService(db);

    const gameTime = await service.getGameTime();
    expect(gameTime.gameTimeDayMinutes).toBe(90);
    expect(gameTime.gameTimeNightMinutes).toBe(30);
  });

  it('обновляет цикл и пишет аудит', async () => {
    const { db, audit } = makeDb();
    const service = new SettingsService(db);

    const updated = await service.updateGameTime(
      {
        gameTimeAnchor: '2026-02-01T00:00:00Z',
        gameTimeDayMinutes: 100,
        gameTimeNightMinutes: 35,
      },
      ACTOR,
    );
    expect(updated.gameTimeDayMinutes).toBe(100);
    expect(audit[0]).toMatchObject({ action: 'SETTINGS_UPDATE', entityType: 'Guild' });
    expect(audit[0]!.comment).toContain('день 100 мин');
  });

  it('невалидные длительности отвергаются', async () => {
    const { db } = makeDb();
    const service = new SettingsService(db);

    await expect(
      service.updateGameTime(
        { gameTimeAnchor: '2026-02-01T00:00:00Z', gameTimeDayMinutes: 0, gameTimeNightMinutes: 30 },
        ACTOR,
      ),
    ).rejects.toThrow();
  });
});

describe('settingsMetadata', () => {
  it('отдаёт подписи и единицы для UI по каждому ключу', () => {
    const meta = settingsMetadata();
    expect(meta).toHaveLength(13);
    expect(meta[0]).toHaveProperty('label');
    expect(meta.find((m) => m.key === 'auction.step')!.unit).toBe('очк.');
  });
});

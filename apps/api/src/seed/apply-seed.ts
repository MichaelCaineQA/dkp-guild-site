import { EVENT_TYPE_NAMES, SEED_GUILD, SEED_SETTINGS, type SeedGuild } from './seed-data';

/**
 * Минимальный интерфейс Prisma-клиента, нужный seed'у, — чтобы логику можно
 * было проверить юнит-тестами на фейке, без БД.
 */
export interface SeedDb {
  guild: {
    findFirst(): Promise<{ id: string } | null>;
    create(args: { data: SeedGuild }): Promise<{ id: string }>;
  };
  eventType: {
    upsert(args: { where: { name: string }; create: { name: string }; update: object }): Promise<unknown>;
  };
  setting: {
    create(args: { data: { key: string; value: number } }): Promise<unknown>;
  };
}

export interface SeedResult {
  guildId: string;
  createdSettings: number;
}

/**
 * Идемпотентный seed: гильдия — создаётся один раз, типы ивентов — upsert,
 * настройки — только отсутствующие (P2002 = уже есть, пропускаем; чужие
 * ошибки БД пробрасываем).
 */
export async function applySeed(db: SeedDb): Promise<SeedResult> {
  let guild = await db.guild.findFirst();
  if (!guild) {
    guild = await db.guild.create({ data: SEED_GUILD });
  }

  for (const name of EVENT_TYPE_NAMES) {
    await db.eventType.upsert({ where: { name }, create: { name }, update: {} });
  }

  let createdSettings = 0;
  for (const setting of SEED_SETTINGS) {
    try {
      await db.setting.create({ data: setting });
      createdSettings++;
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code !== 'P2002') {
        throw error;
      }
    }
  }

  return { guildId: guild.id, createdSettings };
}

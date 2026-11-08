import { EVENT_TYPE_NAMES, SEED_GUILD, SEED_SETTINGS, type SeedGuild } from './seed-data';
import { RULES_SLUGS, RULES_TITLES } from '@dkp/shared';

/**
 * Минимальный интерфейс Prisma-клиента, нужный seed'у, — чтобы логику можно
 * было проверить юнит-тестами на фейке, без БД.
 */
export interface SeedDb {
  rulesPage: {
    upsert(args: {
      where: { slug: string };
      create: { slug: string; title: string; contentMd: string };
      update: object;
    }): Promise<{ slug: string; contentMd: string; version: number; updatedAt: Date }>;
  };
  rulesPageVersion: {
    upsert(args: {
      where: { pageSlug_version: { pageSlug: string; version: number } };
      create: { pageSlug: string; contentMd: string; version: number; createdAt: Date };
      update: object;
    }): Promise<unknown>;
  };
  guild: {
    findFirst(): Promise<{ id: string } | null>;
    create(args: { data: SeedGuild }): Promise<{ id: string }>;
  };
  eventType: {
    upsert(args: {
      where: { name: string };
      create: { name: string };
      update: object;
    }): Promise<unknown>;
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
export async function applySeed(db: SeedDb, guildName?: string): Promise<SeedResult> {
  let guild = await db.guild.findFirst();
  if (!guild) {
    const name = guildName?.trim();
    if (guildName !== undefined && !name) throw new Error('Название гильдии не может быть пустым');
    guild = await db.guild.create({ data: { ...SEED_GUILD, name: name ?? SEED_GUILD.name } });
  }

  for (const name of EVENT_TYPE_NAMES) {
    await db.eventType.upsert({ where: { name }, create: { name }, update: {} });
  }

  for (const slug of RULES_SLUGS) {
    const page = await db.rulesPage.upsert({
      where: { slug },
      create: {
        slug,
        title: RULES_TITLES[slug],
        contentMd: `# ${RULES_TITLES[slug]}\n\nПравила пока не опубликованы. Глава или администратор заполнит эту страницу.`,
      },
      update: {},
    });
    await db.rulesPageVersion.upsert({
      where: { pageSlug_version: { pageSlug: slug, version: page.version } },
      create: {
        pageSlug: slug,
        contentMd: page.contentMd,
        version: page.version,
        createdAt: page.updatedAt,
      },
      update: {},
    });
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

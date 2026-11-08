import { PrismaClient } from '@prisma/client';
import { applySeed, type SeedDb } from '../src/seed/apply-seed';

const prisma = new PrismaClient();

applySeed(prisma as unknown as SeedDb, process.env.INITIAL_GUILD_NAME)
  .then((result) => {
    console.log(`Seed завершён: guild=${result.guildId}, создано настроек: ${result.createdSettings}`);
  })
  .catch((error) => {
    console.error('Seed упал:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

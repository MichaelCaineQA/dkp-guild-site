import { PrismaClient } from '@prisma/client';

/**
 * Тестовые пользователи для e2e и ручной проверки ролей (issue #20).
 * Идемпотентен; никогда не запускать в production — эти пользователи
 * дыра в безопасности, если попадут в прод-базу.
 */
const TEST_USERS = [
  { username: 'test-leader', nickname: 'ТестГлава', rank: 'GUILD_LEADER' },
  { username: 'test-officer', nickname: 'ТестОфицер', rank: 'OFFICER' },
  { username: 'test-member', nickname: 'ТестРядовой', rank: 'MEMBER' },
  { username: 'test-member2', nickname: 'ТестРядовой2', rank: 'MEMBER' },
] as const;

const prisma = new PrismaClient();

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:seed:test запрещён в production');
  }

  for (const { username, nickname, rank } of TEST_USERS) {
    // username/nickname не уникальны в схеме — ищем, потом создаём/обновляем
    const user =
      (await prisma.user.findFirst({ where: { username } })) ??
      (await prisma.user.create({ data: { username } }));

    const member =
      (await prisma.member.findFirst({ where: { nickname } })) ??
      (await prisma.member.create({ data: { nickname } }));

    await prisma.member.update({
      where: { id: member.id },
      data: { rank, userId: user.id },
    });

    console.log(`test-user: ${username} (${rank})`);
  }
}

main()
  .catch((error) => {
    console.error('Seed test users упал:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

import { PrismaClient } from '@prisma/client';

/**
 * Тестовые пользователи для e2e и ручной проверки ролей (issue #20).
 * Идемпотентен; никогда не запускать в production — эти пользователи
 * дыра в безопасности, если попадут в прод-базу.
 *
 * Ревью владельца (п.10): у каждого тестового юзера обязателен класс
 * (роль в бою). Тестовые ивенты (п.6) создаются на ближайшие недели,
 * чтобы расписание не было пустым; идемпотентны по seriesId.
 */
const TEST_USERS = [
  { username: 'test-leader', nickname: 'ТестГлава', rank: 'GUILD_LEADER', combatRole: 'TANK' },
  { username: 'test-officer', nickname: 'ТестОфицер', rank: 'OFFICER', combatRole: 'HEALER' },
  { username: 'test-member', nickname: 'ТестРядовой', rank: 'MEMBER', combatRole: 'DPS' },
  { username: 'test-member2', nickname: 'ТестРядовой2', rank: 'MEMBER', combatRole: 'DPS' },
] as const;

/** Идентификатор тестовой серии: по нему seed отличает свои ивенты. */
const TEST_SERIES_ID = 'seed-test-series';
/** Сколько недель тестовых ивентов вперёд. */
const TEST_SERIES_WEEKS = 3;

const prisma = new PrismaClient();

/** Ближайший вторник от now (включая сегодня) в 17:00 UTC. */
function nextTuesday(): Date {
  const now = new Date();
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 17));
  const daysToTuesday = (2 - date.getUTCDay() + 7) % 7;
  date.setUTCDate(date.getUTCDate() + daysToTuesday);
  return date;
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:seed:test запрещён в production');
  }

  let leaderMemberId: string | null = null;
  let officerMemberId: string | null = null;

  for (const { username, nickname, rank, combatRole } of TEST_USERS) {
    // username/nickname не уникальны в схеме — ищем, потом создаём/обновляем
    const user =
      (await prisma.user.findFirst({ where: { username } })) ??
      (await prisma.user.create({ data: { username } }));

    const member =
      (await prisma.member.findFirst({ where: { nickname } })) ??
      (await prisma.member.create({ data: { nickname } }));

    await prisma.member.update({
      where: { id: member.id },
      data: { rank, userId: user.id, combatRole },
    });

    if (rank === 'GUILD_LEADER') {
      leaderMemberId = member.id;
    }
    if (rank === 'OFFICER') {
      officerMemberId = member.id;
    }

    console.log(`test-user: ${username} (${rank}, ${combatRole})`);
  }

  // Тестовые ивенты: серия «вт/чт 20:00 МСК» на N недель вперёд,
  // чтобы календарь не был пустым (ревью владельца, п.6).
  // Идемпотентно: если серия уже есть — оставляем как есть.
  const existing = await prisma.event.count({ where: { seriesId: TEST_SERIES_ID } });
  if (existing > 0) {
    console.log(`test-events: уже есть (${existing}), пропускаем`);
    return;
  }

  const eventType =
    (await prisma.eventType.findFirst({ where: { name: 'Гильдбосс' } })) ??
    (await prisma.eventType.create({ data: { name: 'Гильдбосс' } }));

  const raidLeadId = officerMemberId ?? leaderMemberId;
  if (!raidLeadId) {
    throw new Error('Не найден РЛ для тестовых ивентов (test-officer/test-leader)');
  }

  const firstStart = nextTuesday();
  let created = 0;
  for (let week = 0; week < TEST_SERIES_WEEKS; week++) {
    for (const dayOffset of [0, 2]) {
      // вт + чт той же недели; endsAt через 2 часа
      const startsAt = new Date(firstStart.getTime() + (week * 7 + dayOffset) * 24 * 60 * 60 * 1000);
      const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
      await prisma.event.create({
        data: {
          eventTypeId: eventType.id,
          mode: 'PVE',
          startsAt,
          endsAt,
          dkpReward: 10,
          raidLeadId,
          seriesId: TEST_SERIES_ID,
          notes: 'Тестовый ивент из db:seed:test',
        },
      });
      created++;
    }
  }
  console.log(`test-events: создано ${created} (серия ${TEST_SERIES_ID})`);
}

main()
  .catch((error) => {
    console.error('Seed test users упал:', error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());

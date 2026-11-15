import {
  PrismaClient,
  Prisma,
  Weapon,
  CombatRole,
  Rank,
  EventMode,
  EventScope,
  EventStatus,
  AttendanceStatus,
  CheckInPhase,
  CheckInStatus,
  DkpEntryType,
  AbsenceStatus,
  AuctionStatus,
  ItemTargetRole,
} from '@prisma/client';
import { applySeed } from '../src/seed/apply-seed';

const prisma = new PrismaClient();

const SEED_TAG = 'SEED_DEV_TL_T2_V3';
const SD = 'sd-';
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const TX_TIMEOUT = 900_000;
const TX_MAXWAIT = 60_000;
const GUILD_NAME = 'SunEclipse';
const LEADER_NICK = 'Дарсиэль';

function at(offsetDays: number, hourUtc = 18, minute = 0): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays, hourUtc, minute, 0),
  );
}

function sid(kind: string, key: string | number): string {
  return `${SD}${kind}-${key}`;
}

const PACK_NAMES = ['Вальхалла', 'Асгард', 'Фолькванг'];

const KP_STRUCTURE: Record<string, string[]> = {
  'Авангард': ['Вальхалла', 'Асгард'],
  'Бастион': ['Фолькванг'],
};

const PACK_LEADER_NICKS: Record<string, string> = {
  'Вальхалла': 'Дарсиэль',
  'Асгард': 'Дрейкар',
  'Фолькванг': 'Хельга',
};

const NICKS: string[] = [
  'Дарсиэль', 'Хельга', 'Дрейкар', 'Мирелла', 'Гром', 'Айвор', 'Торвальд', 'Сирена', 'Лираэль',
  'Тэлон', 'Кайра', 'Фрост', 'Рагнар', 'Грим', 'Никс', 'Орвин', 'Брандт', 'Селена',
  'Аэлин', 'Валорис', 'Веспер', 'Гилдан', 'Дагни', 'Эйра', 'Ивар', 'Йорунн', 'Кальдра',
  'Лейф', 'Магни', 'Ньёрд', 'Один', 'Пелла', 'Рюрик', 'Сигурд', 'Тира', 'Ульв', 'Фенрир',
  'Хальдир', 'Хеймдаль', 'Хильда', 'Эгиль', 'Эрна', 'Ярл', 'Астрид', 'Бьорн', 'Вермунд',
  'Гуннар', 'Диса', 'Ингвар', 'Йордис', 'Кетиль', 'Лейв', 'Мюр', 'Нанна', 'Олаф',
  'Рагнхильд', 'Свейн', 'Трюггви', 'Ульвар', 'Харальд', 'Эльва',
];

const WEAPON_PAIRS_BY_ROLE: Record<CombatRole, Weapon[][]> = {
  TANK: [
    ['SWORD_SHIELD', 'GREATSWORD'],
    ['SWORD_SHIELD', 'WAND'],
    ['SWORD_SHIELD', 'SPEAR'],
  ],
  HEALER: [
    ['WAND', 'LONGBOW'],
    ['WAND', 'STAFF'],
    ['STAFF', 'LONGBOW'],
  ],
  DPS: [
    ['DAGGERS', 'CROSSBOW'],
    ['DAGGERS', 'SPEAR'],
    ['DAGGERS', 'GREATSWORD'],
    ['GREATSWORD', 'SPEAR'],
    ['LONGBOW', 'CROSSBOW'],
    ['LONGBOW', 'STAFF'],
    ['STAFF', 'WAND'],
    ['DAGGERS', 'STAFF'],
  ],
};

interface Profile {
  userKey: string;
  username: string;
  nickname: string;
  rank: Rank;
  combatRole: CombatRole;
  weapons: Weapon[];
  gs: number;
  packName: string;
}

function buildProfiles(): Profile[] {
  const roles: CombatRole[] = ['TANK', 'HEALER', 'DPS'];
  return NICKS.map((nick, i) => {
    const combatRole = i === 0 ? 'TANK' : roles[i % 3];
    const pairs = WEAPON_PAIRS_BY_ROLE[combatRole];
    const weapons = pairs[i % pairs.length];
    const rank: Rank = i === 0 ? 'GUILD_LEADER' : i <= 5 ? 'OFFICER' : 'MEMBER';
    return {
      userKey: `user-${String(i).padStart(2, '0')}`,
      username: `sd-user-${String(i).padStart(2, '0')}`,
      nickname: nick,
      rank,
      combatRole,
      weapons,
      gs: 5500 + ((i * 47) % 1200),
      packName: PACK_NAMES[i % 3],
    };
  });
}

const PROFILES = buildProfiles();

interface EventTypeSpec {
  name: string;
  mode: EventMode;
}

const EVENT_TYPES: EventTypeSpec[] = [
  { name: 'Гейбосс', mode: 'PVE' },
  { name: 'Архбосс', mode: 'PVP' },
  { name: 'Осада замка', mode: 'PVP' },
  { name: 'Осада Boonstone', mode: 'PVP' },
  { name: 'Осада Riftstone', mode: 'PVP' },
  { name: 'Мировой босс', mode: 'PVP' },
  { name: 'Конфликт-босс', mode: 'PVP' },
  { name: 'Подземелье T2', mode: 'PVE' },
  { name: 'Гильдейские контракты', mode: 'PVE' },
  { name: 'Доминион', mode: 'PVP' },
  { name: 'Налоговая доставка', mode: 'PVE' },
  { name: 'Морской босс', mode: 'PVE' },
  { name: 'Крипта теней', mode: 'PVE' },
  { name: 'Арена 3x3', mode: 'PVP' },
  { name: 'Пещера Морокая', mode: 'PVE' },
];

interface ItemSpec {
  name: string;
  rarity: string;
  slot: string;
  targetRoles: ItemTargetRole[];
  defaultStartPrice: number;
}

const ITEMS_REAL: ItemSpec[] = [
  { name: 'Зачарованный клинок королевы Белландир', rarity: 'ARCHBOSS', slot: 'WEAPON', targetRoles: ['TANK'], defaultStartPrice: 320 },
  { name: 'Боевой клинок Тевента', rarity: 'ARCHBOSS', slot: 'WEAPON', targetRoles: ['TANK', 'DPS'], defaultStartPrice: 300 },
  { name: 'Гнев Морокая', rarity: 'WORLD_BOSS', slot: 'WEAPON', targetRoles: ['TANK', 'DPS'], defaultStartPrice: 220 },
  { name: 'Меч Ковазана из песка', rarity: 'WORLD_BOSS', slot: 'WEAPON', targetRoles: ['TANK', 'DPS'], defaultStartPrice: 200 },
  { name: 'Клык лунного волка', rarity: 'EPIC', slot: 'WEAPON', targetRoles: ['DPS'], defaultStartPrice: 160 },
  { name: 'Посох Лунного света', rarity: 'EPIC', slot: 'WEAPON', targetRoles: ['HEALER', 'DPS'], defaultStartPrice: 150 },
  { name: 'Жезл Звёздного света', rarity: 'EPIC', slot: 'WEAPON', targetRoles: ['HEALER'], defaultStartPrice: 140 },
  { name: 'Арбалет Убийцы драконов', rarity: 'EPIC', slot: 'WEAPON', targetRoles: ['DPS'], defaultStartPrice: 160 },
  { name: 'Лук Феникса', rarity: 'EPIC', slot: 'WEAPON', targetRoles: ['DPS'], defaultStartPrice: 160 },
  { name: 'Копьё Вихря', rarity: 'EPIC', slot: 'WEAPON', targetRoles: ['DPS'], defaultStartPrice: 150 },
  { name: 'Клинок Багрового заката', rarity: 'EPIC', slot: 'WEAPON', targetRoles: ['DPS'], defaultStartPrice: 130 },
  { name: 'Щит Каменной стражи', rarity: 'EPIC', slot: 'OFFHAND', targetRoles: ['TANK'], defaultStartPrice: 120 },
  { name: 'Жезл Древнего древа', rarity: 'EPIC', slot: 'WEAPON', targetRoles: ['HEALER'], defaultStartPrice: 130 },
  { name: 'Кинжал Ночного шепота', rarity: 'EPIC', slot: 'WEAPON', targetRoles: ['DPS'], defaultStartPrice: 110 },
  { name: 'Молот Титана', rarity: 'EPIC', slot: 'WEAPON', targetRoles: ['TANK'], defaultStartPrice: 140 },
  { name: 'Топор Павшего короля', rarity: 'EPIC', slot: 'WEAPON', targetRoles: ['DPS'], defaultStartPrice: 125 },
  { name: 'Амулет Вечности', rarity: 'EPIC', slot: 'NECK', targetRoles: ['ALL'], defaultStartPrice: 90 },
  { name: 'Кольцо Кровавой луны', rarity: 'EPIC', slot: 'RING', targetRoles: ['DPS'], defaultStartPrice: 100 },
  { name: 'Кольцо Морского змея', rarity: 'RARE', slot: 'RING', targetRoles: ['ALL'], defaultStartPrice: 60 },
  { name: 'Кольцо Титана', rarity: 'EPIC', slot: 'RING', targetRoles: ['TANK'], defaultStartPrice: 95 },
  { name: 'Ожерелье Лунной жрицы', rarity: 'EPIC', slot: 'NECK', targetRoles: ['HEALER'], defaultStartPrice: 105 },
  { name: 'Пояс Вулкана', rarity: 'EPIC', slot: 'BELT', targetRoles: ['TANK'], defaultStartPrice: 90 },
  { name: 'Пояс Проклятого лорда', rarity: 'EPIC', slot: 'BELT', targetRoles: ['DPS'], defaultStartPrice: 85 },
  { name: 'Наручи Титана', rarity: 'RARE', slot: 'BRACERS', targetRoles: ['TANK', 'DPS'], defaultStartPrice: 70 },
  { name: 'Браслеты Огня', rarity: 'RARE', slot: 'BRACERS', targetRoles: ['ALL'], defaultStartPrice: 65 },
  { name: 'Шлем Немезиды', rarity: 'EPIC', slot: 'HELMET', targetRoles: ['ALL'], defaultStartPrice: 80 },
  { name: 'Корона Мёртвого короля', rarity: 'EPIC', slot: 'HELMET', targetRoles: ['ALL'], defaultStartPrice: 110 },
  { name: 'Накидка Тени', rarity: 'RARE', slot: 'CLOAK', targetRoles: ['DPS'], defaultStartPrice: 65 },
  { name: 'Плащ Бури', rarity: 'EPIC', slot: 'CLOAK', targetRoles: ['ALL'], defaultStartPrice: 90 },
  { name: 'Доспех Ледяного великана', rarity: 'EPIC', slot: 'CHEST', targetRoles: ['TANK'], defaultStartPrice: 130 },
  { name: 'Перчатки Павшего ангела', rarity: 'EPIC', slot: 'GLOVES', targetRoles: ['HEALER'], defaultStartPrice: 85 },
  { name: 'Сандалии Ветра', rarity: 'RARE', slot: 'BOOTS', targetRoles: ['ALL'], defaultStartPrice: 55 },
  { name: 'Сапоги Скорохода', rarity: 'RARE', slot: 'BOOTS', targetRoles: ['ALL'], defaultStartPrice: 50 },
  { name: 'Щит Бастиона', rarity: 'EPIC', slot: 'OFFHAND', targetRoles: ['TANK'], defaultStartPrice: 100 },
  { name: 'Меч Вихря', rarity: 'EPIC', slot: 'WEAPON', targetRoles: ['DPS', 'TANK'], defaultStartPrice: 115 },
];

function buildTemplateItems(): ItemSpec[] {
  const adjectives = ['Багряный', 'Ледяной', 'Тенистый', 'Огненный', 'Звёздный', 'Древний', 'Проклятый', 'Святой', 'Лунный', 'Солнечный'];
  const nouns = ['Клинок', 'Посох', 'Кинжал', 'Щит', 'Лук', 'Арбалет', 'Жезл', 'Копьё', 'Молот', 'Топор', 'Наруч'];
  const suffixes = ['дракона', 'ветра', 'бури', 'тьмы', 'света', 'титана', 'короля', 'хаоса', 'бездны', 'звёзд'];
  const slots = ['WEAPON', 'CHEST', 'RING', 'NECK', 'BOOTS', 'HELMET', 'CLOAK', 'BELT', 'GLOVES', 'BRACERS'];
  const roles: ItemTargetRole[][] = [['DPS'], ['HEALER'], ['TANK'], ['ALL']];
  const result: ItemSpec[] = [];
  for (let i = 0; i < 22; i++) {
    const adj = adjectives[i % adjectives.length];
    const noun = nouns[(i * 3) % nouns.length];
    const suf = suffixes[(i * 7) % suffixes.length];
    result.push({
      name: `${adj} ${noun} ${suf}`,
      rarity: i % 3 === 0 ? 'EPIC' : i % 3 === 1 ? 'RARE' : 'WORLD_BOSS',
      slot: slots[i % slots.length],
      targetRoles: roles[i % roles.length],
      defaultStartPrice: 50 + ((i * 17) % 150),
    });
  }
  return result;
}

const ITEMS: ItemSpec[] = [...ITEMS_REAL, ...buildTemplateItems()];

interface EventSpec {
  key: number;
  typeName: string;
  offsetDays: number;
  hourUtc: number;
  minute: number;
  durationMinutes: number;
  scope: EventScope;
  packName?: string;
  reward: number;
  raidLeadNick: string;
}

function buildEvents(): EventSpec[] {
  const specs: EventSpec[] = [];
  const weekTemplate: Array<Array<{
    type: string;
    hour: number;
    minute: number;
    dur: number;
    scope: EventScope;
    pack?: string;
    reward: number;
  }>> = [
    [
      { type: 'Подземелье T2', hour: 18, minute: 0, dur: 120, scope: 'PACK', pack: 'Вальхалла', reward: 10 },
      { type: 'Гильдейские контракты', hour: 21, minute: 0, dur: 60, scope: 'GUILD', reward: 10 },
    ],
    [
      { type: 'Архбосс', hour: 20, minute: 0, dur: 60, scope: 'GUILD', reward: 25 },
      { type: 'Гейбосс', hour: 21, minute: 30, dur: 60, scope: 'GUILD', reward: 15 },
    ],
    [
      { type: 'Осада Boonstone', hour: 19, minute: 30, dur: 60, scope: 'GUILD', reward: 20 },
      { type: 'Подземелье T2', hour: 18, minute: 0, dur: 120, scope: 'PACK', pack: 'Фолькванг', reward: 10 },
    ],
    [
      { type: 'Гейбосс', hour: 18, minute: 0, dur: 60, scope: 'GUILD', reward: 15 },
      { type: 'Мировой босс', hour: 21, minute: 0, dur: 60, scope: 'GUILD', reward: 20 },
    ],
    [
      { type: 'Архбосс', hour: 20, minute: 0, dur: 60, scope: 'GUILD', reward: 25 },
      { type: 'Гильдейские контракты', hour: 18, minute: 0, dur: 60, scope: 'PACK', pack: 'Асгард', reward: 10 },
    ],
    [
      { type: 'Осада замка', hour: 18, minute: 0, dur: 60, scope: 'GUILD', reward: 30 },
      { type: 'Осада Riftstone', hour: 20, minute: 0, dur: 60, scope: 'GUILD', reward: 20 },
    ],
    [
      { type: 'Доминион', hour: 19, minute: 0, dur: 60, scope: 'GUILD', reward: 20 },
      { type: 'Конфликт-босс', hour: 21, minute: 0, dur: 60, scope: 'GUILD', reward: 20 },
    ],
  ];

  const raidLeads = ['Хельга', 'Дрейкар', 'Мирелла', 'Дарсиэль'];
  let idx = 0;
  for (let offset = -14; offset <= 14; offset++) {
    const weekday = ((offset % 7) + 7) % 7;
    const template = weekTemplate[weekday];
    for (let i = 0; i < template.length; i++) {
      const t = template[i];
      specs.push({
        key: idx++,
        typeName: t.type,
        offsetDays: offset,
        hourUtc: t.hour,
        minute: t.minute,
        durationMinutes: t.dur,
        scope: t.scope,
        packName: t.pack,
        reward: t.reward,
        raidLeadNick: raidLeads[idx % raidLeads.length],
      });
    }
  }
  return specs;
}

const EVENTS = buildEvents();

interface AbsenceSpec {
  key: number;
  memberIdx: number;
  offsetFrom: number;
  offsetTo: number;
  hourFrom: number;
  hourTo: number;
  reason: string;
}

function buildAbsences(): AbsenceSpec[] {
  const reasons = [
    'Семейные обстоятельства',
    'Работа до поздна',
    'Отпуск',
    'Плохое самочувствие',
    'Поездка к родственникам',
    'Технические проблемы с ПК',
  ];
  const result: AbsenceSpec[] = [];
  for (let i = 0; i < 55; i++) {
    const memberIdx = 6 + (i % 54);
    const startDay = -7 + (i % 21);
    const days = 1 + (i % 3);
    result.push({
      key: i,
      memberIdx,
      offsetFrom: startDay,
      offsetTo: startDay + days,
      hourFrom: 6,
      hourTo: 22,
      reason: reasons[i % reasons.length],
    });
  }
  return result;
}

const ABSENCES = buildAbsences();

interface AuctionSpec {
  key: number;
  itemIdx: number;
  status: AuctionStatus;
  bidderMemberIdxs: number[];
  winnerIdx?: number;
}

function buildAuctions(): AuctionSpec[] {
  const specs: AuctionSpec[] = [];
  for (let i = 0; i < 50; i++) {
    const itemIdx = i % ITEMS.length;
    const status: AuctionStatus = i < 20 ? 'CLOSED' : i < 45 ? 'OPEN' : 'CANCELLED';
    const bidderIdxs: number[] = [];
    const bidderCount = i % 4;
    for (let b = 0; b < bidderCount; b++) {
      bidderIdxs.push(6 + ((i * 7 + b * 13) % 54));
    }
    const spec: AuctionSpec = {
      key: i,
      itemIdx,
      status,
      bidderMemberIdxs: bidderIdxs,
    };
    if (status === 'CLOSED' && bidderIdxs.length > 0) {
      spec.winnerIdx = bidderIdxs[bidderIdxs.length - 1];
    }
    specs.push(spec);
  }
  return specs;
}

const AUCTIONS = buildAuctions();

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:seed:dev запрещён в production');
  }

  const { guildId } = await applySeed(prisma, GUILD_NAME);
  console.log(`seed-dev: guild=${guildId}`);

  await prisma.$transaction(
    async (tx) => {
      // 1. ИТЕМЫ
      const itemsByKey = new Map<number, { id: string; targetRoles: ItemTargetRole[]; startPrice: number }>();
      for (let i = 0; i < ITEMS.length; i++) {
        const spec = ITEMS[i];
        const item = await tx.item.upsert({
          where: { name: spec.name },
          update: {
            rarity: spec.rarity,
            slot: spec.slot,
            targetRoles: spec.targetRoles,
            defaultStartPrice: spec.defaultStartPrice,
          },
          create: {
            name: spec.name,
            rarity: spec.rarity,
            slot: spec.slot,
            targetRoles: spec.targetRoles,
            defaultStartPrice: spec.defaultStartPrice,
          },
        });
        itemsByKey.set(i, {
          id: item.id,
          targetRoles: spec.targetRoles,
          startPrice: spec.defaultStartPrice,
        });
      }

      // 2. ТИПЫ ИВЕНТОВ
      const eventTypeIdByName = new Map<string, string>();
      for (const et of EVENT_TYPES) {
        const created = await tx.eventType.upsert({
          where: { name: et.name },
          update: {},
          create: { name: et.name },
        });
        eventTypeIdByName.set(et.name, created.id);
      }

      // 3. ПРАВИЛА
      const guildRulesMd =
        '# Правила гильдии SunEclipse\n\n' +
        '1. Посещение ГвГ-ивентов (Осада, Boonstone, Архбосс) — приоритет.\n' +
        '2. Отсутствие на ивенте оформляй через сайт минимум за 3 минуты до старта.\n' +
        '3. ДКП начисляется за каждый чек-ин-код (старт/финал), по 50% от платы ивента.\n' +
        '4. Аукцион открытый; наценка «чужому» классу +10%, скидка за предпочитаемый предмет 10%.\n' +
        '5. Токсичность и слив лута вне аукциона — исключение из гильдии.\n';
      const siteRulesMd =
        '# Правила пользования сайтом\n\n' +
        '1. Discord OAuth — единственный вход для членов гильдии.\n' +
        '2. GS и скриншоты видны только Главе/Админу.\n' +
        '3. Все ручные действия с ДКП и лутом пишутся в аудит-лог.\n' +
        '4. Смена класса/предпочитаемого предмета — не чаще раза в 2 недели.\n';
      await tx.rulesPage.upsert({
        where: { slug: 'guild-rules' },
        update: { contentMd: guildRulesMd },
        create: { slug: 'guild-rules', title: 'Правила гильдии', contentMd: guildRulesMd },
      });
      await tx.rulesPage.upsert({
        where: { slug: 'site-rules' },
        update: { contentMd: siteRulesMd },
        create: { slug: 'site-rules', title: 'Правила пользования сайтом', contentMd: siteRulesMd },
      });

      // 4. КП и ПАКИ
      const packIdByName = new Map<string, string>();
      for (const [kpName, packNames] of Object.entries(KP_STRUCTURE)) {
        let kp = await tx.kP.findFirst({ where: { guildId, name: kpName } });
        if (!kp) kp = await tx.kP.create({ data: { guildId, name: kpName } });
        for (const packName of packNames) {
          let pack = await tx.pack.findFirst({ where: { kpId: kp.id, name: packName } });
          if (!pack) pack = await tx.pack.create({ data: { kpId: kp.id, name: packName } });
          packIdByName.set(packName, pack.id);
        }
      }
      // сброс лидерства у наших паков, чтобы избежать unique-конфликта
      await tx.pack.updateMany({
        where: { name: { in: PACK_NAMES } },
        data: { leaderId: null },
      });

      // 5. ЛИДЕР
      const existingLeader = await tx.member.findFirst({ where: { rank: 'GUILD_LEADER' } });
      const someoneElseIsLeader = existingLeader !== null && existingLeader.nickname !== LEADER_NICK;

      // 6. ПОЛЬЗОВАТЕЛИ и ЧЛЕНЫ
      const memberIdByNickname = new Map<string, string>();
      const memberIdByIndex = new Map<number, string>();
      const memberIdxByNickname = new Map<string, number>();
      const preferredItemByRole: Record<CombatRole, string> = {
        TANK: 'Пояс Вулкана',
        HEALER: 'Жезл Звёздного света',
        DPS: 'Кольцо Кровавой луны',
      };
      const preferredIdByRole: Record<CombatRole, string | null> = {
        TANK: null,
        HEALER: null,
        DPS: null,
      };
      for (const spec of ITEMS_REAL) {
        if (spec.name === 'Пояс Вулкана') preferredIdByRole.TANK = (await tx.item.findUnique({ where: { name: spec.name } }))?.id ?? null;
        if (spec.name === 'Жезл Звёздного света') preferredIdByRole.HEALER = (await tx.item.findUnique({ where: { name: spec.name } }))?.id ?? null;
        if (spec.name === 'Кольцо Кровавой луны') preferredIdByRole.DPS = (await tx.item.findUnique({ where: { name: spec.name } }))?.id ?? null;
      }
      void preferredItemByRole;

      for (let i = 0; i < PROFILES.length; i++) {
        const p = PROFILES[i];

        const userId = sid(p.userKey, '');
        const existingUser = await tx.user.findFirst({ where: { username: p.username } });
        const user = existingUser
          ? await tx.user.update({
              where: { id: existingUser.id },
              data: { username: p.username },
            })
          : await tx.user.create({
              data: {
                id: userId,
                username: p.username,
                discordId: `dev-discord-${p.username}`,
              },
            });

        let rank: Rank = p.rank;
        if (p.rank === 'GUILD_LEADER' && someoneElseIsLeader) {
          rank = 'OFFICER';
        }

        const packId = packIdByName.get(p.packName) ?? null;
        const preferredId = preferredIdByRole[p.combatRole];
        const cooldownAgo = new Date(Date.now() - 15 * DAY_MS);

        const existingMember = await tx.member.findFirst({ where: { nickname: p.nickname } });
        const member = existingMember
          ? await tx.member.update({
              where: { id: existingMember.id },
              data: {
                rank,
                combatRole: p.combatRole,
                weapons: p.weapons,
                packId,
                packJoinedAt: packId ? new Date(Date.now() - 30 * DAY_MS) : null,
                preferredItemId: preferredId,
                preferredItemChangedAt: cooldownAgo,
                combatRoleChangedAt: cooldownAgo,
              },
            })
          : await tx.member.create({
              data: {
                id: sid('member', String(i).padStart(2, '0')),
                userId: user.id,
                nickname: p.nickname,
                rank,
                combatRole: p.combatRole,
                weapons: p.weapons,
                packId,
                packJoinedAt: packId ? new Date(Date.now() - 30 * DAY_MS) : null,
                preferredItemId: preferredId,
                preferredItemChangedAt: cooldownAgo,
                combatRoleChangedAt: cooldownAgo,
              },
            });
        memberIdByNickname.set(p.nickname, member.id);
        memberIdByIndex.set(i, member.id);
        memberIdxByNickname.set(p.nickname, i);

        // 7. ПРАЙМ-ТАЙМ
        const slotData = [
          { weekday: 0, fromMinute: 1140, toMinute: 1380 },
          { weekday: 1, fromMinute: 1140, toMinute: 1380 },
          { weekday: 2, fromMinute: 1140, toMinute: 1380 },
          { weekday: 3, fromMinute: 1140, toMinute: 1380 },
          { weekday: 4, fromMinute: 1140, toMinute: 1439 },
          { weekday: 5, fromMinute: 720, toMinute: 1439 },
          { weekday: 6, fromMinute: 720, toMinute: 1380 },
        ];
        for (let s = 0; s < slotData.length; s++) {
          const slot = slotData[s];
          await tx.primeTimeSlot.upsert({
            where: { id: sid('pt', `${i}-${slot.weekday}`) },
            update: { fromMinute: slot.fromMinute, toMinute: slot.toMinute },
            create: {
              id: sid('pt', `${i}-${slot.weekday}`),
              memberId: member.id,
              weekday: slot.weekday,
              fromMinute: slot.fromMinute,
              toMinute: slot.toMinute,
            },
          });
        }

        // 8. GS
        await tx.gearScoreRecord.upsert({
          where: { id: sid('gs', `${i}-0`) },
          update: { value: p.gs },
          create: {
            id: sid('gs', `${i}-0`),
            memberId: member.id,
            value: p.gs,
            createdAt: new Date(Date.now() - 2 * DAY_MS),
          },
        });
        await tx.gearScoreRecord.upsert({
          where: { id: sid('gs', `${i}-1`) },
          update: { value: p.gs - 50 },
          create: {
            id: sid('gs', `${i}-1`),
            memberId: member.id,
            value: p.gs - 50,
            createdAt: new Date(Date.now() - 20 * DAY_MS),
          },
        });
      }

      // 9. ЛИДЕРЫ ПАКОВ
      for (const [packName, leaderNick] of Object.entries(PACK_LEADER_NICKS)) {
        const packId = packIdByName.get(packName);
        let leaderId = memberIdByNickname.get(leaderNick);
        // если чужой лидер — назначаем первого из пака
        if (!leaderId) {
          const fallback = PROFILES.find((p) => p.packName === packName);
          if (fallback) leaderId = memberIdByNickname.get(fallback.nickname);
        }
        if (packId && leaderId) {
          await tx.pack.update({ where: { id: packId }, data: { leaderId } });
        }
      }

      // 10. СОБЫТИЯ + ЧЕК-ИН КОДЫ + ПОСЕЩЕНИЯ + ДКП
      const leaderIdForAudit = memberIdByNickname.get(LEADER_NICK) ?? memberIdByIndex.get(0)!;
      const officerCreatorId = memberIdByNickname.get('Хельга') ?? leaderIdForAudit;

      for (const spec of EVENTS) {
        const startsAt = at(spec.offsetDays, spec.hourUtc, spec.minute);
        const endsAt = new Date(startsAt.getTime() + spec.durationMinutes * 60_000);
        const isPast = spec.offsetDays < 0;
        const status: EventStatus = isPast ? 'FINISHED' : 'PLANNED';
        const eventTypeId = eventTypeIdByName.get(spec.typeName)!;
        const packId = spec.packName ? packIdByName.get(spec.packName) ?? null : null;
        const mode = EVENT_TYPES.find((e) => e.name === spec.typeName)?.mode ?? 'PVE';
        const raidLeadId = memberIdByNickname.get(spec.raidLeadNick) ?? leaderIdForAudit;
        const eventId = sid('evt', String(spec.key).padStart(3, '0'));

        await tx.event.upsert({
          where: { id: eventId },
          update: {
            status,
            startsAt,
            endsAt,
            raidLeadId,
            packId,
            dkpReward: spec.reward,
          },
          create: {
            id: eventId,
            eventTypeId,
            mode,
            status,
            scope: spec.scope,
            packId,
            raidLeadId,
            creatorId: officerCreatorId,
            startsAt,
            endsAt,
            dkpReward: spec.reward,
            name: spec.typeName,
            notes: 'Данные seed-dev (T&L T2)',
            seriesId: SEED_TAG,
          },
        });

        if (!isPast) continue;

        let invited: { id: string; idx: number }[];
        if (spec.scope === 'PACK' && packId) {
          const members = await tx.member.findMany({
            where: { packId },
            select: { id: true },
          });
          invited = members
            .map((m) => {
              const idx = PROFILES.findIndex((p) => memberIdByNickname.get(p.nickname) === m.id);
              return { id: m.id, idx };
            })
            .filter((m) => m.idx >= 0);
        } else {
          invited = PROFILES.map((p, idx) => ({ id: memberIdByIndex.get(idx)!, idx }));
        }
        if (invited.length === 0) continue;

        // check-in codes
        await tx.checkInCode.upsert({
          where: { eventId_phase: { eventId, phase: 'START' } },
          update: {
            windowOpensAt: new Date(startsAt.getTime() - 3 * 60_000),
            windowClosesAt: new Date(startsAt.getTime() + 3 * 60_000),
          },
          create: {
            id: sid('cic', `${spec.key}-S`),
            eventId,
            phase: 'START',
            codeHash: `dev-hash-start-${spec.key}`,
            salt: `dev-salt-start-${spec.key}`,
            windowOpensAt: new Date(startsAt.getTime() - 3 * 60_000),
            windowClosesAt: new Date(startsAt.getTime() + 3 * 60_000),
          },
        });
        await tx.checkInCode.upsert({
          where: { eventId_phase: { eventId, phase: 'END' } },
          update: {
            windowOpensAt: new Date(endsAt.getTime() - 3 * 60_000),
            windowClosesAt: new Date(endsAt.getTime() + 3 * 60_000),
          },
          create: {
            id: sid('cic', `${spec.key}-E`),
            eventId,
            phase: 'END',
            codeHash: `dev-hash-end-${spec.key}`,
            salt: `dev-salt-end-${spec.key}`,
            windowOpensAt: new Date(endsAt.getTime() - 3 * 60_000),
            windowClosesAt: new Date(endsAt.getTime() + 3 * 60_000),
          },
        });

        // attendance + dkp
        for (let k = 0; k < invited.length; k++) {
          const m = invited[k];
          const mod = (m.idx + Math.abs(spec.offsetDays) + spec.key) % 10;
          let attendanceStatus: AttendanceStatus = 'PRESENT';
          let cs: CheckInStatus = 'PASSED';
          let ce: CheckInStatus = 'PASSED';
          let earned = spec.reward;

          if (mod === 7) {
            attendanceStatus = 'LATE';
            cs = 'EXPIRED';
            ce = 'PASSED';
            earned = Math.ceil(spec.reward / 2);
          } else if (mod === 8) {
            attendanceStatus = 'LEFT_EARLY';
            cs = 'PASSED';
            ce = 'EXPIRED';
            earned = Math.ceil(spec.reward / 2);
          } else if (mod === 9) {
            attendanceStatus = 'NO_SHOW';
            cs = 'EXPIRED';
            ce = 'EXPIRED';
            earned = 0;
          }

          await tx.attendance.upsert({
            where: { eventId_memberId: { eventId, memberId: m.id } },
            update: { status: attendanceStatus, checkinStart: cs, checkinEnd: ce },
            create: {
              id: sid('att', `${spec.key}-${m.idx}`),
              eventId,
              memberId: m.id,
              status: attendanceStatus,
              checkinStart: cs,
              checkinEnd: ce,
            },
          });

          if (earned > 0) {
            const requestId = sid('dkp', `${spec.key}-${m.idx}`);
            await tx.dkpEntry.upsert({
              where: { requestId },
              update: { amount: earned },
              create: {
                id: sid('dkpe', `${spec.key}-${m.idx}`),
                requestId,
                memberId: m.id,
                type: DkpEntryType.CHECKIN_EARN,
                amount: earned,
                eventId,
                comment: `Начисление за ${spec.typeName} (seed)`,
              },
            });
          }
        }
      }

      // 11. ОТСУТСТВИЯ
      const leaderId = memberIdByNickname.get(LEADER_NICK) ?? leaderIdForAudit;
      for (const spec of ABSENCES) {
        const memberId = memberIdByIndex.get(spec.memberIdx);
        if (!memberId) continue;
        const absenceId = sid('abs', String(spec.key).padStart(2, '0'));
        const dateFrom = at(spec.offsetFrom, spec.hourFrom);
        const dateTo = at(spec.offsetTo, spec.hourTo);
        await tx.absence.upsert({
          where: { id: absenceId },
          update: {
            dateFrom,
            dateTo,
            reason: spec.reason,
            status: AbsenceStatus.ACTIVE,
          },
          create: {
            id: absenceId,
            memberId,
            dateFrom,
            dateTo,
            eligibleFrom: new Date(Date.now() - 3 * HOUR_MS),
            allDay: false,
            reason: spec.reason,
            status: AbsenceStatus.ACTIVE,
          },
        });
        if (spec.key % 3 === 0) {
          await tx.absenceSeen.upsert({
            where: { absenceId_seenById: { absenceId, seenById: leaderId } },
            update: {},
            create: {
              id: sid('absseen', spec.key),
              absenceId,
              seenById: leaderId,
              actorKey: `member:${leaderId}`,
            },
          });
        }
      }

      // 12. АУКЦИОНЫ
      for (const spec of AUCTIONS) {
        const item = itemsByKey.get(spec.itemIdx);
        if (!item) continue;
        const dropId = sid('drop', String(spec.key).padStart(2, '0'));
        const drop = await tx.lootDrop.upsert({
          where: { id: dropId },
          update: {},
          create: { id: dropId, itemId: item.id, eventId: null },
        });
        const endsAt = spec.status === 'OPEN'
          ? new Date(Date.now() + 18 * HOUR_MS)
          : new Date(Date.now() - 6 * HOUR_MS);

        const auction = await tx.auction.upsert({
          where: { lootDropId: drop.id },
          update: { status: spec.status, endsAt },
          create: {
            id: sid('auc', String(spec.key).padStart(2, '0')),
            lootDropId: drop.id,
            status: spec.status,
            startPrice: item.startPrice,
            step: 5,
            durationSec: 48 * 60 * 60,
            timerFromFirstBid: false,
            antiSnipeSec: 600,
            antiSnipeExtendSec: 600,
            markupPct: 10,
            discountPct: 10,
            targetRoles: item.targetRoles,
            firstBidAt: spec.bidderMemberIdxs.length > 0 ? new Date(Date.now() - 6 * HOUR_MS) : null,
            endsAt,
          },
        });

        let currentPrice = item.startPrice;
        for (let b = 0; b < spec.bidderMemberIdxs.length; b++) {
          const memberIdx = spec.bidderMemberIdxs[b];
          const memberId = memberIdByIndex.get(memberIdx);
          const profile = PROFILES[memberIdx];
          if (!memberId || !profile) continue;
          currentPrice += 5;
          const roleMismatch =
            !item.targetRoles.includes('ALL') &&
            !item.targetRoles.some((r) => r === (profile.combatRole as unknown as ItemTargetRole));
          const appliedMarkup = roleMismatch ? 10 : 0;
          const appliedDiscount = 10;
          const afterMarkup = Math.ceil(currentPrice * (1 + appliedMarkup / 100));
          const fullCost = Math.ceil(afterMarkup * (1 - appliedDiscount / 100));
          await tx.bid.upsert({
            where: { id: sid('bid', `${spec.key}-${b}`) },
            update: { amount: currentPrice, fullCost },
            create: {
              id: sid('bid', `${spec.key}-${b}`),
              auctionId: auction.id,
              memberId,
              amount: currentPrice,
              fullCost,
              markupPct: appliedMarkup,
              discountPct: appliedDiscount,
            },
          });
        }

        if (spec.status === 'CLOSED' && spec.winnerIdx !== undefined) {
          const winnerId = memberIdByIndex.get(spec.winnerIdx);
          if (!winnerId) continue;
          const lastBid = await tx.bid.findFirst({
            where: { auctionId: auction.id },
            orderBy: { createdAt: 'desc' },
          });
          const finalPrice = lastBid?.fullCost ?? item.startPrice;
          await tx.lootAward.upsert({
            where: { auctionId: auction.id },
            update: {
              winnerId,
              finalPrice,
              markupPct: lastBid?.markupPct ?? 0,
              discountPct: lastBid?.discountPct ?? 0,
            },
            create: {
              id: sid('award', spec.key),
              auctionId: auction.id,
              winnerId,
              finalPrice,
              markupPct: lastBid?.markupPct ?? 0,
              discountPct: lastBid?.discountPct ?? 0,
            },
          });
          const requestId = sid('dkp-auc', spec.key);
          await tx.dkpEntry.upsert({
            where: { requestId },
            update: { amount: -finalPrice },
            create: {
              id: sid('dkpe-auc', spec.key),
              requestId,
              memberId: winnerId,
              type: DkpEntryType.AUCTION_SPEND,
              amount: -finalPrice,
              auctionId: auction.id,
              comment: `Победа в лоте «${ITEMS[spec.itemIdx].name}» (seed)`,
            },
          });
        }
      }

      // 13. РУЧНЫЕ ДКП-ЗАПИСИ
      for (let i = 0; i < 55; i++) {
        const memberIdx = 6 + (i % 54);
        const memberId = memberIdByIndex.get(memberIdx);
        if (!memberId) continue;
        const requestId = sid('dkp-man', i);
        await tx.dkpEntry.upsert({
          where: { requestId },
          update: {},
          create: {
            id: sid('dkpe-man', i),
            requestId,
            memberId,
            type: i % 4 === 0 ? DkpEntryType.ADJUSTMENT : DkpEntryType.MANUAL_EARN,
            amount: i % 4 === 0 ? -5 : 10,
            createdById: leaderId,
            comment: i % 4 === 0 ? 'Корректировка (seed)' : 'Бонус за помощь (seed)',
          },
        });
      }

      // 14. АУДИТ
      for (let i = 0; i < 60; i++) {
        const actions = ['ROLE_CHANGE', 'MANUAL_ATTENDANCE', 'AUCTION_ASSIGN_WINNER', 'DKP_GRANT', 'PROFILE_UPDATE'];
        const entityTypes = ['Member', 'Event', 'Auction', 'Member', 'Member'];
        await tx.auditLog.upsert({
          where: { id: sid('audit', i) },
          update: {},
          create: {
            id: sid('audit', i),
            actorMemberId: leaderId,
            actorIsAdmin: false,
            action: actions[i % actions.length],
            entityType: entityTypes[i % entityTypes.length],
            entityId: sid('ref', i),
            comment: `Демонстрационная запись #${i} (seed)`,
          },
        });
      }

      // 15. МАРКЕР
      await tx.auditLog.upsert({
        where: { id: sid('marker', SEED_TAG) },
        update: {},
        create: {
          id: sid('marker', SEED_TAG),
          actorMemberId: null,
          actorIsAdmin: true,
          action: SEED_TAG,
          entityType: 'System',
          entityId: SEED_TAG,
          comment: 'Маркер seed-dev',
        },
      });

      console.log(`seed-dev: внутри транзакции готово`);
    },
    { timeout: TX_TIMEOUT, maxWait: TX_MAXWAIT },
  );

  console.log(
    `seed-dev: готово. Members=${PROFILES.length}, Events=${EVENTS.length}, Items=${ITEMS.length}, Auctions=${AUCTIONS.length}, Absences=${ABSENCES.length}`,
  );
}

main()
  .catch((err) => {
    console.error('seed-dev упал:', err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
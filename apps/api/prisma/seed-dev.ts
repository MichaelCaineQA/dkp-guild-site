import {
  PrismaClient,
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
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MARKER = 'SEED_DEV_TL_T2_V2';

function at(offsetDays: number, hourUtc = 18, minute = 0): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays, hourUtc, minute, 0),
  );
}

type Profile = {
  username: string;
  nickname: string;
  rank: Rank;
  combatRole: CombatRole;
  weapons: Weapon[];
  gs: number;
  pack: string;
};

const PROFILES: Profile[] = [
  { username: 'darsiel',  nickname: 'Дарсиэль',  rank: Rank.GUILD_LEADER, combatRole: CombatRole.TANK,   weapons: ['SWORD_SHIELD', 'GREATSWORD'], gs: 6700, pack: 'Вальхалла' },
  { username: 'helga',    nickname: 'Хельга',    rank: Rank.OFFICER,      combatRole: CombatRole.DPS,    weapons: ['LONGBOW', 'CROSSBOW'],        gs: 6550, pack: 'Асгард' },
  { username: 'draykar',  nickname: 'Дрейкар',   rank: Rank.OFFICER,      combatRole: CombatRole.DPS,    weapons: ['DAGGERS', 'GREATSWORD'],      gs: 6480, pack: 'Вальхалла' },
  { username: 'mirella',  nickname: 'Мирелла',   rank: Rank.OFFICER,      combatRole: CombatRole.HEALER, weapons: ['WAND', 'STAFF'],              gs: 6420, pack: 'Фолькванг' },
  { username: 'grom',     nickname: 'Гром',      rank: Rank.MEMBER,       combatRole: CombatRole.TANK,   weapons: ['SWORD_SHIELD', 'GREATSWORD'], gs: 6180, pack: 'Вальхалла' },
  { username: 'aivor',    nickname: 'Айвор',     rank: Rank.MEMBER,       combatRole: CombatRole.TANK,   weapons: ['SWORD_SHIELD', 'WAND'],       gs: 5950, pack: 'Вальхалла' },
  { username: 'torvald',  nickname: 'Торвальд',  rank: Rank.MEMBER,       combatRole: CombatRole.TANK,   weapons: ['SWORD_SHIELD', 'GREATSWORD'], gs: 5750, pack: 'Вальхалла' },
  { username: 'sirena',   nickname: 'Сирена',    rank: Rank.MEMBER,       combatRole: CombatRole.HEALER, weapons: ['WAND', 'LONGBOW'],            gs: 6120, pack: 'Вальхалла' },
  { username: 'lirael',   nickname: 'Лираэль',   rank: Rank.MEMBER,       combatRole: CombatRole.HEALER, weapons: ['WAND', 'STAFF'],              gs: 5880, pack: 'Вальхалла' },
  { username: 'telon',    nickname: 'Тэлон',     rank: Rank.MEMBER,       combatRole: CombatRole.DPS,    weapons: ['DAGGERS', 'CROSSBOW'],        gs: 6350, pack: 'Асгард' },
  { username: 'kaira',    nickname: 'Кайра',     rank: Rank.MEMBER,       combatRole: CombatRole.DPS,    weapons: ['DAGGERS', 'SPEAR'],           gs: 6090, pack: 'Асгард' },
  { username: 'frost',    nickname: 'Фрост',     rank: Rank.MEMBER,       combatRole: CombatRole.DPS,    weapons: ['DAGGERS', 'CROSSBOW'],        gs: 5920, pack: 'Асгард' },
  { username: 'ragnar',   nickname: 'Рагнар',    rank: Rank.MEMBER,       combatRole: CombatRole.DPS,    weapons: ['GREATSWORD', 'SPEAR'],        gs: 5840, pack: 'Асгард' },
  { username: 'grim',     nickname: 'Грим',      rank: Rank.MEMBER,       combatRole: CombatRole.DPS,    weapons: ['DAGGERS', 'GREATSWORD'],      gs: 5680, pack: 'Асгард' },
  { username: 'nyx',      nickname: 'Никс',      rank: Rank.MEMBER,       combatRole: CombatRole.DPS,    weapons: ['DAGGERS', 'SPEAR'],           gs: 5540, pack: 'Асгард' },
  { username: 'orvin',    nickname: 'Орвин',     rank: Rank.MEMBER,       combatRole: CombatRole.DPS,    weapons: ['STAFF', 'WAND'],              gs: 6240, pack: 'Фолькванг' },
  { username: 'brandt',   nickname: 'Брандт',    rank: Rank.MEMBER,       combatRole: CombatRole.DPS,    weapons: ['LONGBOW', 'CROSSBOW'],        gs: 6050, pack: 'Фолькванг' },
  { username: 'selena',   nickname: 'Селена',    rank: Rank.MEMBER,       combatRole: CombatRole.DPS,    weapons: ['LONGBOW', 'STAFF'],           gs: 5790, pack: 'Фолькванг' },
];

const KP_STRUCTURE: Record<string, string[]> = {
  'Авангард': ['Вальхалла', 'Асгард'],
  'Бастион':  ['Фолькванг'],
};

const PACK_LEADERS: Record<string, string> = {
  'Вальхалла': 'Дарсиэль',
  'Асгард':    'Дрейкар',
  'Фолькванг': 'Хельга',
};

const EVENT_TYPES = [
  { name: 'Гейбосс',               mode: EventMode.PVE },
  { name: 'Архбосс',               mode: EventMode.PVP },
  { name: 'Осада замка',           mode: EventMode.PVP },
  { name: 'Осада Boonstone',       mode: EventMode.PVP },
  { name: 'Осада Riftstone',       mode: EventMode.PVP },
  { name: 'Мировой босс',          mode: EventMode.PVP },
  { name: 'Конфликт-босс',         mode: EventMode.PVP },
  { name: 'Подземелье T2',         mode: EventMode.PVE },
  { name: 'Гильдейские контракты', mode: EventMode.PVE },
  { name: 'Доминион',              mode: EventMode.PVP },
] as const;

const ITEMS: Array<{
  name: string;
  rarity: string;
  slot: string;
  targetRoles: ItemTargetRole[];
  defaultStartPrice: number;
}> = [
  { name: 'Зачарованный клинок королевы Белландир', rarity: 'ARCHBOSS',   slot: 'WEAPON',  targetRoles: [ItemTargetRole.TANK],                      defaultStartPrice: 300 },
  { name: 'Боевой клинок Тевента',                  rarity: 'ARCHBOSS',   slot: 'WEAPON',  targetRoles: [ItemTargetRole.TANK, ItemTargetRole.DPS],   defaultStartPrice: 280 },
  { name: 'Гнев Морокая',                           rarity: 'WORLD_BOSS', slot: 'WEAPON',  targetRoles: [ItemTargetRole.TANK, ItemTargetRole.DPS],   defaultStartPrice: 200 },
  { name: 'Меч Ковазана из песка',                  rarity: 'WORLD_BOSS', slot: 'WEAPON',  targetRoles: [ItemTargetRole.TANK, ItemTargetRole.DPS],   defaultStartPrice: 180 },
  { name: 'Клык лунного волка',                     rarity: 'EPIC',       slot: 'WEAPON',  targetRoles: [ItemTargetRole.DPS],                        defaultStartPrice: 150 },
  { name: 'Посох Лунного света',                    rarity: 'EPIC',       slot: 'WEAPON',  targetRoles: [ItemTargetRole.HEALER, ItemTargetRole.DPS], defaultStartPrice: 140 },
  { name: 'Жезл Звёздного света',                   rarity: 'EPIC',       slot: 'WEAPON',  targetRoles: [ItemTargetRole.HEALER],                     defaultStartPrice: 130 },
  { name: 'Арбалет Убийцы драконов',                rarity: 'EPIC',       slot: 'WEAPON',  targetRoles: [ItemTargetRole.DPS],                        defaultStartPrice: 150 },
  { name: 'Лук Феникса',                            rarity: 'EPIC',       slot: 'WEAPON',  targetRoles: [ItemTargetRole.DPS],                        defaultStartPrice: 150 },
  { name: 'Копьё Вихря',                            rarity: 'EPIC',       slot: 'WEAPON',  targetRoles: [ItemTargetRole.DPS],                        defaultStartPrice: 140 },
  { name: 'Амулет Вечности',                        rarity: 'EPIC',       slot: 'NECK',    targetRoles: [ItemTargetRole.ALL],                        defaultStartPrice: 80  },
  { name: 'Кольцо Кровавой луны',                   rarity: 'EPIC',       slot: 'RING',    targetRoles: [ItemTargetRole.DPS],                        defaultStartPrice: 100 },
  { name: 'Кольцо Морского змея',                   rarity: 'RARE',       slot: 'RING',    targetRoles: [ItemTargetRole.ALL],                        defaultStartPrice: 60  },
  { name: 'Пояс Вулкана',                           rarity: 'EPIC',       slot: 'BELT',    targetRoles: [ItemTargetRole.TANK],                       defaultStartPrice: 90  },
  { name: 'Наручи Титана',                          rarity: 'RARE',       slot: 'BRACERS', targetRoles: [ItemTargetRole.TANK, ItemTargetRole.DPS],   defaultStartPrice: 70  },
  { name: 'Шлем Немезиды',                          rarity: 'EPIC',       slot: 'HELMET',  targetRoles: [ItemTargetRole.ALL],                        defaultStartPrice: 80  },
  { name: 'Накидка Тени',                           rarity: 'RARE',       slot: 'CLOAK',   targetRoles: [ItemTargetRole.DPS],                        defaultStartPrice: 65  },
];

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('db:seed:dev запрещён в production');
  }

  const marker = await prisma.auditLog.findFirst({ where: { action: MARKER } });
  if (marker) {
    console.log('seed-dev: уже применялся ранее, пропускаем');
    return;
  }

  const { guildId } = await applySeed(prisma, 'SunEclipse');
  console.log(`seed-dev: guild=${guildId}`);

  const itemsByName = new Map<string, { id: string; targetRoles: ItemTargetRole[]; startPrice: number }>();
  for (const spec of ITEMS) {
    const item = await prisma.item.upsert({
      where: { name: spec.name },
      update: {},
      create: {
        name: spec.name,
        rarity: spec.rarity,
        slot: spec.slot,
        targetRoles: spec.targetRoles,
        defaultStartPrice: spec.defaultStartPrice,
      },
    });
    itemsByName.set(spec.name, {
      id: item.id,
      targetRoles: spec.targetRoles,
      startPrice: spec.defaultStartPrice,
    });
  }

  const eventTypesByName = new Map<string, string>();
  for (const et of EVENT_TYPES) {
    const created = await prisma.eventType.upsert({
      where: { name: et.name },
      update: {},
      create: { name: et.name },
    });
    eventTypesByName.set(et.name, created.id);
  }

  const packsByName = new Map<string, string>();
  for (const [kpName, packNames] of Object.entries(KP_STRUCTURE)) {
    let kp = await prisma.kP.findFirst({ where: { guildId, name: kpName } });
    if (!kp) kp = await prisma.kP.create({ data: { guildId, name: kpName } });
    for (const packName of packNames) {
      let pack = await prisma.pack.findFirst({ where: { kpId: kp.id, name: packName } });
      if (!pack) pack = await prisma.pack.create({ data: { kpId: kp.id, name: packName } });
      packsByName.set(packName, pack.id);
    }
  }

  const membersByNickname = new Map<
    string,
    { id: string; rank: Rank; combatRole: CombatRole }
  >();
  for (const p of PROFILES) {
    const user =
      (await prisma.user.findFirst({ where: { username: p.username } })) ??
      (await prisma.user.create({
        data: { username: p.username, discordId: `dev-${p.username}-discord` },
      }));

    const preferredItemName =
      p.combatRole === CombatRole.HEALER
        ? 'Жезл Звёздного света'
        : p.combatRole === CombatRole.TANK
          ? 'Пояс Вулкана'
          : 'Кольцо Кровавой луны';
    const preferred = itemsByName.get(preferredItemName);

    const packId = packsByName.get(p.pack);
    const cooldownAgo = new Date(Date.now() - 15 * DAY_MS);

    let member = await prisma.member.findFirst({ where: { nickname: p.nickname } });
    if (!member) {
      member = await prisma.member.create({
        data: {
          userId: user.id,
          nickname: p.nickname,
          rank: p.rank,
          combatRole: p.combatRole,
          weapons: p.weapons,
          packId: packId ?? null,
          packJoinedAt: packId ? new Date(Date.now() - 30 * DAY_MS) : null,
          preferredItemId: preferred?.id ?? null,
          preferredItemChangedAt: cooldownAgo,
          combatRoleChangedAt: cooldownAgo,
        },
      });
    }
    membersByNickname.set(p.nickname, {
      id: member.id,
      rank: member.rank as Rank,
      combatRole: member.combatRole as CombatRole,
    });

    if ((await prisma.primeTimeSlot.count({ where: { memberId: member.id } })) === 0) {
      await prisma.primeTimeSlot.createMany({
        data: [
          { memberId: member.id, weekday: 0, fromMinute: 1140, toMinute: 1380 },
          { memberId: member.id, weekday: 1, fromMinute: 1140, toMinute: 1380 },
          { memberId: member.id, weekday: 2, fromMinute: 1140, toMinute: 1380 },
          { memberId: member.id, weekday: 3, fromMinute: 1140, toMinute: 1380 },
          { memberId: member.id, weekday: 4, fromMinute: 1140, toMinute: 1439 },
          { memberId: member.id, weekday: 5, fromMinute: 720,  toMinute: 1439 },
          { memberId: member.id, weekday: 6, fromMinute: 720,  toMinute: 1380 },
        ],
      });
    }

    if ((await prisma.gearScoreRecord.count({ where: { memberId: member.id } })) === 0) {
      await prisma.gearScoreRecord.create({
        data: { memberId: member.id, value: p.gs, createdAt: new Date(Date.now() - 2 * DAY_MS) },
      });
    }
  }

  for (const [packName, leaderNick] of Object.entries(PACK_LEADERS)) {
    const packId = packsByName.get(packName);
    const leader = membersByNickname.get(leaderNick);
    if (packId && leader) {
      await prisma.pack.update({ where: { id: packId }, data: { leaderId: leader.id } });
    }
  }

  const leaderId = membersByNickname.get('Дарсиэль')!.id;
  const officerHelga = membersByNickname.get('Хельга')!.id;
  const officerDraykar = membersByNickname.get('Дрейкар')!.id;
  const officerMirella = membersByNickname.get('Мирелла')!.id;

  type EventSpec = {
    typeName: string;
    offsetDays: number;
    hourUtc: number;
    minute: number;
    durationMinutes: number;
    scope: EventScope;
    packName?: string;
    reward: number;
    raidLeadId: string;
  };

  const eventSpecs: EventSpec[] = [
    { typeName: 'Подземелье T2',   offsetDays: -7, hourUtc: 18, minute: 0,  durationMinutes: 120, scope: EventScope.PACK,  packName: 'Вальхалла', reward: 10, raidLeadId: officerMirella },
    { typeName: 'Архбосс',         offsetDays: -6, hourUtc: 20, minute: 0,  durationMinutes: 60,  scope: EventScope.GUILD,                            reward: 25, raidLeadId: officerHelga },
    { typeName: 'Осада Boonstone', offsetDays: -5, hourUtc: 19, minute: 30, durationMinutes: 60,  scope: EventScope.GUILD,                            reward: 20, raidLeadId: officerDraykar },
    { typeName: 'Подземелье T2',   offsetDays: -4, hourUtc: 18, minute: 0,  durationMinutes: 120, scope: EventScope.PACK,  packName: 'Фолькванг', reward: 10, raidLeadId: officerHelga },
    { typeName: 'Гейбосс',         offsetDays: -3, hourUtc: 18, minute: 0,  durationMinutes: 60,  scope: EventScope.GUILD,                            reward: 15, raidLeadId: officerHelga },
    { typeName: 'Архбосс',         offsetDays: -2, hourUtc: 20, minute: 0,  durationMinutes: 60,  scope: EventScope.GUILD,                            reward: 25, raidLeadId: leaderId },
    { typeName: 'Осада замка',     offsetDays: -1, hourUtc: 18, minute: 0,  durationMinutes: 60,  scope: EventScope.GUILD,                            reward: 30, raidLeadId: leaderId },
    { typeName: 'Подземелье T2',   offsetDays: 1,  hourUtc: 18, minute: 0,  durationMinutes: 120, scope: EventScope.PACK,  packName: 'Асгард',    reward: 10, raidLeadId: officerDraykar },
    { typeName: 'Архбосс',         offsetDays: 2,  hourUtc: 20, minute: 0,  durationMinutes: 60,  scope: EventScope.GUILD,                            reward: 25, raidLeadId: officerHelga },
    { typeName: 'Осада Boonstone', offsetDays: 3,  hourUtc: 19, minute: 30, durationMinutes: 60,  scope: EventScope.GUILD,                            reward: 20, raidLeadId: officerDraykar },
    { typeName: 'Подземелье T2',   offsetDays: 4,  hourUtc: 18, minute: 0,  durationMinutes: 120, scope: EventScope.PACK,  packName: 'Вальхалла', reward: 10, raidLeadId: officerMirella },
    { typeName: 'Гейбосс',         offsetDays: 5,  hourUtc: 18, minute: 0,  durationMinutes: 60,  scope: EventScope.GUILD,                            reward: 15, raidLeadId: officerHelga },
    { typeName: 'Архбосс',         offsetDays: 6,  hourUtc: 20, minute: 0,  durationMinutes: 60,  scope: EventScope.GUILD,                            reward: 25, raidLeadId: leaderId },
    { typeName: 'Осада замка',     offsetDays: 7,  hourUtc: 18, minute: 0,  durationMinutes: 60,  scope: EventScope.GUILD,                            reward: 30, raidLeadId: leaderId },
  ];

  const allMemberIds = Array.from(membersByNickname.values()).map((m) => m.id);

  for (const spec of eventSpecs) {
    const eventTypeId = eventTypesByName.get(spec.typeName)!;
    const startsAt = at(spec.offsetDays, spec.hourUtc, spec.minute);
    const endsAt = new Date(startsAt.getTime() + spec.durationMinutes * 60 * 1000);
    const isPast = spec.offsetDays < 0;
    const status = isPast ? EventStatus.FINISHED : EventStatus.PLANNED;
    const packId = spec.packName ? packsByName.get(spec.packName) ?? null : null;
    const eventMode = EVENT_TYPES.find((e) => e.name === spec.typeName)?.mode ?? EventMode.PVE;

    const event = await prisma.event.create({
      data: {
        eventTypeId,
        mode: eventMode,
        status,
        scope: spec.scope,
        packId,
        raidLeadId: spec.raidLeadId,
        creatorId: officerHelga,
        startsAt,
        endsAt,
        dkpReward: spec.reward,
        name: spec.typeName,
        notes: 'Данные seed-dev (T&L T2)',
        seriesId: MARKER,
      },
    });

    if (!isPast) continue;

    let invited: string[];
    if (spec.scope === EventScope.PACK && packId) {
      invited = (await prisma.member.findMany({ where: { packId }, select: { id: true } })).map((m) => m.id);
    } else {
      invited = allMemberIds;
    }
    if (invited.length === 0) continue;

    await prisma.checkInCode.createMany({
      data: [
        {
          eventId: event.id,
          phase: CheckInPhase.START,
          codeHash: `dev-hash-start-${event.id}`,
          salt: `dev-salt-start-${event.id}`,
          windowOpensAt: new Date(startsAt.getTime() - 3 * 60 * 1000),
          windowClosesAt: new Date(startsAt.getTime() + 3 * 60 * 1000),
        },
        {
          eventId: event.id,
          phase: CheckInPhase.END,
          codeHash: `dev-hash-end-${event.id}`,
          salt: `dev-salt-end-${event.id}`,
          windowOpensAt: new Date(endsAt.getTime() - 3 * 60 * 1000),
          windowClosesAt: new Date(endsAt.getTime() + 3 * 60 * 1000),
        },
      ],
      skipDuplicates: true,
    });

    for (let i = 0; i < invited.length; i++) {
      const memberId = invited[i];
      const mod = (i + Math.abs(spec.offsetDays) + 3) % 10;
      let status: AttendanceStatus = AttendanceStatus.PRESENT;
      let cs: CheckInStatus = CheckInStatus.PASSED;
      let ce: CheckInStatus = CheckInStatus.PASSED;
      let earned = spec.reward;

      if (mod === 7) {
        status = AttendanceStatus.LATE;
        cs = CheckInStatus.EXPIRED;
        ce = CheckInStatus.PASSED;
        earned = Math.ceil(spec.reward / 2);
      } else if (mod === 8) {
        status = AttendanceStatus.LEFT_EARLY;
        cs = CheckInStatus.PASSED;
        ce = CheckInStatus.EXPIRED;
        earned = Math.ceil(spec.reward / 2);
      } else if (mod === 9) {
        status = AttendanceStatus.NO_SHOW;
        cs = CheckInStatus.EXPIRED;
        ce = CheckInStatus.EXPIRED;
        earned = 0;
      }

      await prisma.attendance.create({
        data: { eventId: event.id, memberId, status, checkinStart: cs, checkinEnd: ce },
      });

      if (earned > 0) {
        await prisma.dkpEntry.create({
          data: {
            memberId,
            type: DkpEntryType.CHECKIN_EARN,
            amount: earned,
            eventId: event.id,
            comment: `Начисление за ${spec.typeName} (seed)`,
          },
        });
      }
    }
  }

  const orvin = membersByNickname.get('Орвин')!;
  const absence = await prisma.absence.create({
    data: {
      memberId: orvin.id,
      dateFrom: at(2, 0),
      dateTo: at(4, 23),
      eligibleFrom: new Date(Date.now() - 3 * HOUR_MS),
      allDay: false,
      reason: 'Уезжаю на выходные, буду в понедельник (seed-dev)',
      status: AbsenceStatus.ACTIVE,
    },
  });
  await prisma.absenceSeen.create({
    data: {
      absenceId: absence.id,
      actorKey: `member:${leaderId}`,
      seenById: leaderId,
    },
  });

  async function createAuction(opts: {
    itemName: string;
    status: AuctionStatus;
    bidderNicks: string[];
    finalWinner?: string;
  }): Promise<void> {
    const item = itemsByName.get(opts.itemName)!;
    const drop = await prisma.lootDrop.create({
      data: { itemId: item.id, eventId: null },
    });

    const startPrice = item.startPrice;
    const auction = await prisma.auction.create({
      data: {
        lootDropId: drop.id,
        status: opts.status,
        startPrice,
        step: 5,
        durationSec: 48 * 60 * 60,
        timerFromFirstBid: false,
        antiSnipeSec: 600,
        antiSnipeExtendSec: 600,
        markupPct: 10,
        discountPct: 10,
        targetRoles: item.targetRoles,
        firstBidAt: opts.bidderNicks.length > 0 ? new Date(Date.now() - 6 * HOUR_MS) : null,
        endsAt: new Date(Date.now() + 18 * HOUR_MS),
      },
    });

    let current = startPrice;
    for (const nick of opts.bidderNicks) {
      const member = membersByNickname.get(nick);
      if (!member) continue;
      current += 5;
      const roleMismatch =
        !item.targetRoles.includes(ItemTargetRole.ALL) &&
        !item.targetRoles.some((r) => r === (member.combatRole as unknown as ItemTargetRole));
      const appliedMarkup = roleMismatch ? 10 : 0;
      const appliedDiscount = 10;
      const afterMarkup = Math.ceil(current * (1 + appliedMarkup / 100));
      const fullCost = Math.ceil(afterMarkup * (1 - appliedDiscount / 100));
      await prisma.bid.create({
        data: {
          auctionId: auction.id,
          memberId: member.id,
          amount: current,
          fullCost,
          markupPct: appliedMarkup,
          discountPct: appliedDiscount,
        },
      });
    }

    if (opts.status === AuctionStatus.CLOSED && opts.finalWinner) {
      const winner = membersByNickname.get(opts.finalWinner);
      if (!winner) return;
      const lastBid = await prisma.bid.findFirst({
        where: { auctionId: auction.id },
        orderBy: { createdAt: 'desc' },
      });
      const finalPrice = lastBid?.fullCost ?? startPrice;
      await prisma.lootAward.create({
        data: {
          auctionId: auction.id,
          winnerId: winner.id,
          finalPrice,
          markupPct: lastBid?.markupPct ?? 0,
          discountPct: lastBid?.discountPct ?? 0,
        },
      });
      await prisma.dkpEntry.create({
        data: {
          memberId: winner.id,
          type: DkpEntryType.AUCTION_SPEND,
          amount: -finalPrice,
          auctionId: auction.id,
          comment: `Победа в лоте «${opts.itemName}» (seed)`,
        },
      });
    }
  }

  await createAuction({
    itemName: 'Гнев Морокая',
    status: AuctionStatus.CLOSED,
    bidderNicks: ['Гром', 'Торвальд', 'Айвор'],
    finalWinner: 'Гром',
  });
  await createAuction({
    itemName: 'Клык лунного волка',
    status: AuctionStatus.OPEN,
    bidderNicks: ['Тэлон', 'Кайра', 'Фрост'],
  });
  await createAuction({
    itemName: 'Кольцо Кровавой луны',
    status: AuctionStatus.CANCELLED,
    bidderNicks: [],
  });

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

  await prisma.rulesPage.upsert({
    where: { slug: 'guild-rules' },
    update: { contentMd: guildRulesMd },
    create: { slug: 'guild-rules', title: 'Правила гильдии', contentMd: guildRulesMd },
  });
  await prisma.rulesPage.upsert({
    where: { slug: 'site-rules' },
    update: { contentMd: siteRulesMd },
    create: { slug: 'site-rules', title: 'Правила пользования сайтом', contentMd: siteRulesMd },
  });

  const auditExamples = [
    { action: 'ROLE_CHANGE',           entityType: 'Member',  entityId: leaderId,       comment: 'Назначение Хельги офицером (seed)' },
    { action: 'MANUAL_ATTENDANCE',     entityType: 'Event',   entityId: 'seed-event',   comment: 'Ручная отметка РЛ (seed)' },
    { action: 'AUCTION_ASSIGN_WINNER', entityType: 'Auction', entityId: 'seed-auction', comment: 'Ручное назначение победителя (seed)' },
    { action: 'DKP_GRANT',             entityType: 'Member',  entityId: leaderId,       comment: 'Бонус за организацию осады (seed)' },
  ];
  for (const a of auditExamples) {
    await prisma.auditLog.create({
      data: {
        actorMemberId: leaderId,
        actorIsAdmin: false,
        action: a.action,
        entityType: a.entityType,
        entityId: a.entityId,
        comment: a.comment,
      },
    });
  }
  await prisma.auditLog.create({
    data: {
      actorMemberId: null,
      actorIsAdmin: true,
      action: MARKER,
      entityType: 'System',
      entityId: 'seed-dev',
      comment: 'Маркер идемпотентности seed-dev',
    },
  });

  console.log(`seed-dev: готово. Профилей: ${PROFILES.length}, ивентов: ${eventSpecs.length}, предметов: ${ITEMS.length}`);
}

main()
  .catch((err) => {
    console.error('seed-dev упал:', err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
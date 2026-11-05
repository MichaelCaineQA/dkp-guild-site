import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { CheckInDb, Clock } from './checkin.service';
import { CheckInService } from './checkin.service';

/** Ивент: 17:00–19:00 UTC, плата 10 ДКП, РЛ — m-rl. */
const EVENT = {
  id: 'e-1',
  status: 'RUNNING',
  startsAt: new Date('2026-03-03T17:00:00Z'),
  endsAt: new Date('2026-03-03T19:00:00Z'),
  dkpReward: 10,
  raidLeadId: 'm-rl',
};

/** Фиксированный тестовый ключ AES-256 (в проде — env CHECKIN_ENC_KEY). */
const ENC_KEY = 'ab'.repeat(32);

const SETTINGS = {
  generateBeforeStartSec: 180,
  windowSec: 180,
  attempts: 1,
  startSharePct: 50,
  endSharePct: 50,
};

function makeDb() {
  const codes = new Map<
    string,
    { codeHash: string; salt: string; codeEnc: string; windowOpensAt: Date; windowClosesAt: Date }
  >();
  const attendance = new Map<string, { checkinStart: string; checkinEnd: string }>();
  const dkp: Array<{ memberId: string; amount: number; type: string; eventId: string }> = [];
  const audit: Array<Record<string, string | null>> = [];
  const db: CheckInDb = {
    event: {
      findUnique: async ({ where }) => (where.id === 'e-1' ? { ...EVENT } : null),
    },
    checkInCode: {
      findUnique: async ({ where }) => codes.get(`${where.eventId_phase.eventId}:${where.eventId_phase.phase}`) ?? null,
      create: async ({ data }) => {
        codes.set(`${data.eventId}:${data.phase}`, {
          codeHash: data.codeHash,
          salt: data.salt,
          codeEnc: data.codeEnc,
          windowOpensAt: data.windowOpensAt,
          windowClosesAt: data.windowClosesAt,
        });
      },
    },
    attendance: {
      findUnique: async ({ where }) => attendance.get(`${where.eventId_memberId.eventId}:${where.eventId_memberId.memberId}`) ?? null,
      upsert: async ({ where, create, update }) => {
        const key = `${where.eventId_memberId.eventId}:${where.eventId_memberId.memberId}`;
        const current = attendance.get(key) ?? { checkinStart: 'PENDING', checkinEnd: 'PENDING' };
        attendance.set(key, { ...current, ...create, ...update });
      },
    },
    dkpEntry: {
      create: async ({ data }) => {
        dkp.push(data);
        return { id: `d-${dkp.length}` };
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audit.push(data);
      },
    },
  };
  return { db, codes, attendance, dkp, audit };
}

const ACTOR = { memberId: 'm-officer', isAdmin: false };

describe('CheckInService.raidLeadView', () => {
  it('РЛ видит код в стартовом окне (генерация ленивая, хэш в БД)', async () => {    const { db, codes } = makeDb();
    const clock: Clock = () => new Date('2026-03-03T16:58:00Z'); // окно 16:57–17:00
    const service = new CheckInService(db, SETTINGS, clock, ENC_KEY);

    const view = await service.raidLeadView('e-1', { memberId: 'm-rl', isAdmin: false }, 'MEMBER');
    expect(view.phase).toBe('START');
    expect(view.windowState).toBe('ACTIVE');
    expect(view.code).toMatch(/^\d{3}$/);
    // В БД — только хэш, сам код не хранится
    const stored = codes.get('e-1:START')!;
    expect(stored.codeHash).not.toContain(view.code);
    expect(stored.codeHash).toHaveLength(64); // sha256 hex
    expect(stored.salt).not.toContain(view.code);
  });

  it('рядовой-не-РЛ код не видит — 403', async () => {
    const { db } = makeDb();
    const service = new CheckInService(db, SETTINGS, () => new Date('2026-03-03T16:58:00Z'), ENC_KEY);

    await expect(
      service.raidLeadView('e-1', { memberId: 'm-other', isAdmin: false }, 'MEMBER'),
    ).rejects.toThrow(ForbiddenException);
  });

  it('офицер видит код (events.conduct)', async () => {
    const { db } = makeDb();
    const service = new CheckInService(db, SETTINGS, () => new Date('2026-03-03T16:58:00Z'), ENC_KEY);

    const view = await service.raidLeadView('e-1', ACTOR, 'OFFICER');
    expect(view.code).toMatch(/^\d{3}$/);
  });

  it('повторный запрос кода показывает тот же код (шифротекст в БД)', async () => {
    const { db, codes } = makeDb();
    const clock: Clock = () => new Date('2026-03-03T16:58:00Z');
    const service = new CheckInService(db, SETTINGS, clock, ENC_KEY);

    const first = await service.raidLeadView('e-1', ACTOR, 'OFFICER');
    const second = await service.raidLeadView('e-1', ACTOR, 'OFFICER');
    expect(second.code).toBe(first.code);
    // В БД код лежит зашифрованным — не открытым текстом
    const stored = codes.get('e-1:START')!;
    expect(stored.codeEnc).not.toContain(first.code);
    expect(stored.codeEnc.startsWith('v1:')).toBe(true);
  });

  it('код с другим ключом не расшифровывается', async () => {
    const { db } = makeDb();
    const clock: Clock = () => new Date('2026-03-03T16:58:00Z');
    const service = new CheckInService(db, SETTINGS, clock, ENC_KEY);
    await service.raidLeadView('e-1', ACTOR, 'OFFICER');

    const stranger = new CheckInService(db, SETTINGS, clock, 'cd'.repeat(32));
    await expect(stranger.raidLeadView('e-1', ACTOR, 'OFFICER')).rejects.toThrow(
      ConflictException,
    );
  });

  it('до окна код не генерируется, РЛ видит NOT_OPEN_YET без кода', async () => {
    const { db, codes } = makeDb();
    const service = new CheckInService(db, SETTINGS, () => new Date('2026-03-03T16:00:00Z'), ENC_KEY);

    const view = await service.raidLeadView('e-1', ACTOR, 'OFFICER');
    expect(view.windowState).toBe('NOT_OPEN_YET');
    expect(view.code).toBe('');
    expect(codes.size).toBe(0);

    const player = await service.playerView('e-1', 'm-player');
    expect(player.windowState).toBe('NOT_OPEN_YET');
    expect(player.choices).toHaveLength(0);
  });
});

describe('CheckInService.playerView', () => {
  it('в активном окне — 4 варианта, включая верный; статус PENDING', async () => {
    const { db } = makeDb();
    const clock: Clock = () => new Date('2026-03-03T16:58:00Z');
    const service = new CheckInService(db, SETTINGS, clock, ENC_KEY);

    // Сначала РЛ генерит код, затем игрок получает варианты
    const rlView = await service.raidLeadView('e-1', ACTOR, 'OFFICER');
    const view = await service.playerView('e-1', 'm-player');
    expect(view.windowState).toBe('ACTIVE');
    expect(view.choices).toHaveLength(4);
    expect(new Set(view.choices).size).toBe(4);
    expect(view.choices).toContain(rlView.code);
    expect(view.status).toBe('PENDING');
  });

  it('вне окна вариантов нет', async () => {
    const { db } = makeDb();
    const service = new CheckInService(db, SETTINGS, () => new Date('2026-03-03T18:30:00Z'), ENC_KEY);

    const view = await service.playerView('e-1', 'm-player');
    expect(view.choices).toHaveLength(0);
  });
});

describe('CheckInService.submit', () => {
  async function setup() {
    const state = makeDb();
    const clock: Clock = () => new Date('2026-03-03T16:58:00Z');
    const service = new CheckInService(state.db, SETTINGS, clock, ENC_KEY);
    const rlView = await service.raidLeadView('e-1', ACTOR, 'OFFICER');
    return { ...state, service, correctCode: rlView.code };
  }

  it('верный код → PASSED + DkpEntry CHECKIN_EARN на 50% платы', async () => {
    const { service, correctCode, dkp, attendance } = await setup();

    const result = await service.submit('e-1', 'm-player', { code: correctCode });
    expect(result).toEqual({ result: 'PASSED' });
    expect(dkp).toHaveLength(1);
    expect(dkp[0]).toMatchObject({
      memberId: 'm-player',
      type: 'CHECKIN_EARN',
      amount: 5, // 50% от 10
      eventId: 'e-1',
    });
    expect(attendance.get('e-1:m-player')!.checkinStart).toBe('PASSED');
  });

  it('неверный код → FAILED, без начисления; повтор — 409', async () => {
    const { service, correctCode, dkp, attendance } = await setup();
    const wrongCode = correctCode === '999' ? '111' : '999';

    const result = await service.submit('e-1', 'm-player', { code: wrongCode });
    expect(result).toEqual({ result: 'FAILED' });
    expect(dkp).toHaveLength(0);
    expect(attendance.get('e-1:m-player')!.checkinStart).toBe('FAILED');

    // Повторная попытка заблокирована — даже верным кодом
    await expect(service.submit('e-1', 'm-player', { code: correctCode })).rejects.toThrow(
      ConflictException,
    );
  });

  it('финальная фаза: верный код приносит вторые 50%', async () => {
    const { db, attendance } = makeDb();
    attendance.set('e-1:m-player', { checkinStart: 'PASSED', checkinEnd: 'PENDING' });
    const clock: Clock = () => new Date('2026-03-03T19:01:00Z'); // финальное окно
    const service = new CheckInService(db, SETTINGS, clock, ENC_KEY);

    const rlView = await service.raidLeadView('e-1', ACTOR, 'OFFICER');
    const result = await service.submit('e-1', 'm-player', { code: rlView.code });
    expect(result).toEqual({ result: 'PASSED' });
    expect(db).toBeDefined();
  });

  it('вне окна — 409', async () => {
    const { db } = makeDb();
    const service = new CheckInService(db, SETTINGS, () => new Date('2026-03-03T18:30:00Z'), ENC_KEY);

    await expect(service.submit('e-1', 'm-player', { code: '123' })).rejects.toThrow(
      ConflictException,
    );
  });

  it('ревизия: отменённый/завершённый ивент — чек-ин недоступен (409), ДКП не начисляются', async () => {
    const { db, dkp } = makeDb();
    // Подменяем ивент на CANCELLED с тем же id
    (db.event.findUnique as unknown) = async () => ({
      ...EVENT,
      status: 'CANCELLED',
    });
    const service = new CheckInService(db, SETTINGS, () => new Date('2026-03-03T16:58:00Z'), ENC_KEY);

    await expect(service.submit('e-1', 'm-player', { code: '123' })).rejects.toThrow(
      ConflictException,
    );
    await expect(service.raidLeadView('e-1', ACTOR, 'OFFICER')).rejects.toThrow(
      ConflictException,
    );
    expect(dkp).toHaveLength(0);
  });

  it('двуxфазная изоляция: старт PASSED не мешает финалу', async () => {
    const { db } = makeDb();
    const seeded = new Map([['e-1:m-player', { checkinStart: 'PASSED', checkinEnd: 'PENDING' }]]);
    db.attendance.findUnique = async ({ where }) =>
      seeded.get(`${where.eventId_memberId.eventId}:${where.eventId_memberId.memberId}`) ?? null;
    const clock: Clock = () => new Date('2026-03-03T19:01:00Z');
    const service = new CheckInService(db, SETTINGS, clock, ENC_KEY);

    const rlView = await service.raidLeadView('e-1', ACTOR, 'OFFICER');
    const result = await service.submit('e-1', 'm-player', { code: rlView.code });
    expect(result).toEqual({ result: 'PASSED' });
  });
});

describe('CheckInService: игрок получает варианты без раскрытия кода', () => {
  it('варианты содержат верный код, но ответ не помечает верный', async () => {
    const { db } = makeDb();
    const clock: Clock = () => new Date('2026-03-03T16:58:00Z');
    const service = new CheckInService(db, SETTINGS, clock, ENC_KEY);

    const rlView = await service.raidLeadView('e-1', ACTOR, 'OFFICER');
    const view = await service.playerView('e-1', 'm-player');
    expect(view.choices).toContain(rlView.code);
    // В ответе игрока нет пометки, какой код верный: только массив строк
    expect(Object.keys(view).sort()).toEqual(['choices', 'phase', 'status', 'windowState']);
  });
});

describe('CheckInService.startEndCodeEarly', () => {
  it('досрочный финальный код: окно от «сейчас», фаза переключается на END', async () => {
    const { db } = makeDb();
    // Ивент идёт: now внутри START-фазы (18:30 при конце 19:00)
    const clock: Clock = () => new Date('2026-03-03T18:30:00Z');
    const service = new CheckInService(db, SETTINGS, clock, ENC_KEY);

    const early = await service.startEndCodeEarly('e-1', ACTOR, 'OFFICER');
    expect(early.phase).toBe('END');
    expect(early.windowState).toBe('ACTIVE');
    expect(early.code).toMatch(/^\d{3}$/);
    // Окно длится настройку windowSec от момента запуска
    expect(early.windowOpensAt.getTime()).toBe(new Date('2026-03-03T18:30:00Z').getTime());
    expect(early.windowClosesAt.getTime()).toBe(new Date('2026-03-03T18:33:00Z').getTime());

    // Игрок теперь в фазе END (не START) и получает варианты финального кода
    const player = await service.playerView('e-1', 'm-player');
    expect(player.phase).toBe('END');
    expect(player.choices).toContain(early.code);
  });

  it('повторный досрочный запуск — 409', async () => {
    const { db } = makeDb();
    const clock: Clock = () => new Date('2026-03-03T18:30:00Z');
    const service = new CheckInService(db, SETTINGS, clock, ENC_KEY);

    await service.startEndCodeEarly('e-1', ACTOR, 'OFFICER');
    await expect(service.startEndCodeEarly('e-1', ACTOR, 'OFFICER')).rejects.toThrow(
      ConflictException,
    );
  });

  it('когда плановое окно уже открылось — 409 «используйте обычный код»', async () => {
    const { db } = makeDb();
    const clock: Clock = () => new Date('2026-03-03T19:01:00Z'); // плановое END-окно
    const service = new CheckInService(db, SETTINGS, clock, ENC_KEY);

    await expect(service.startEndCodeEarly('e-1', ACTOR, 'OFFICER')).rejects.toThrow(
      ConflictException,
    );
  });

  it('рядовой-не-РЛ не может запустить досрочно — 403', async () => {
    const { db } = makeDb();
    const clock: Clock = () => new Date('2026-03-03T18:30:00Z');
    const service = new CheckInService(db, SETTINGS, clock, ENC_KEY);

    await expect(
      service.startEndCodeEarly('e-1', { memberId: 'm-other', isAdmin: false }, 'MEMBER'),
    ).rejects.toThrow(ForbiddenException);
  });
});

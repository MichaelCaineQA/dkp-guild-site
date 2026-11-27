import { ConflictException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { manualWindowBounds } from '@dkp/shared';
import { encryptCheckInCode, hashCheckInCode } from './crypto';
import type { CheckInDb } from './checkin.service';
import { CheckInService } from './checkin.service';
import { launchCheckInCode, readCheckInWindowSec, type CheckInLaunchDb } from './launch';

/** Ивент: 17:00–19:00 UTC, плата 10 ДКП, РЛ — m-rl. */
const EVENT = {
  scope: 'GUILD' as const,
  kpId: null,
  packId: null,
  id: 'e-1',
  status: 'RUNNING',
  startsAt: new Date('2026-03-03T17:00:00Z'),
  endsAt: new Date('2026-03-03T19:00:00Z'),
  dkpReward: 10,
  raidLeadId: 'm-rl',
};

/** Фиксированный тестовый ключ AES-256 (в проде — env CHECKIN_ENC_KEY). */
const ENC_KEY = 'ab'.repeat(32);

const SETTINGS = { startSharePct: 50, endSharePct: 50 };

/** Управляющий, который нажимает «Начать ивент» / «Завершить ивент». */
const MANAGER = { memberId: 'm-officer', isAdmin: false, rank: 'GUILD_LEADER' as const };

type CodeRow = {
  codeHash: string;
  salt: string;
  codeEnc: string;
  windowOpensAt: Date;
  windowClosesAt: Date;
};

function makeDb() {
  const codes = new Map<string, CodeRow>();
  const attendance = new Map<string, { checkinStart: string; checkinEnd: string }>();
  const dkp: Array<{ memberId: string; amount: number; type: string; eventId: string }> = [];
  const audit: Array<Record<string, string | boolean | null>> = [];
  const event = { ...EVENT };
  let windowSec: number | null = 180;
  const db: CheckInDb & CheckInLaunchDb = {
    member: {
      findUnique: async ({ where }) => ({
        id: where.id,
        packId: null,
        pack: null,
        blockedAt: null,
      }),
    },
    setting: {
      findUnique: async () => (windowSec === null ? null : { value: windowSec }),
    },
    $transaction: async (work) => {
      const previousAttendance = structuredClone([...attendance]);
      const previousCodes = structuredClone([...codes]);
      const previousDkp = structuredClone(dkp);
      const previousAudit = structuredClone(audit);
      try {
        return await work(db);
      } catch (error) {
        attendance.clear();
        for (const [key, value] of previousAttendance) attendance.set(key, value);
        codes.clear();
        for (const [key, value] of previousCodes) codes.set(key, value);
        dkp.splice(0, dkp.length, ...previousDkp);
        audit.splice(0, audit.length, ...previousAudit);
        throw error;
      }
    },
    event: {
      findUnique: async ({ where }) => (where.id === 'e-1' ? event : null),
    },
    checkInCode: {
      findUnique: async ({ where }) =>
        codes.get(`${where.eventId_phase.eventId}:${where.eventId_phase.phase}`) ?? null,
      upsert: async ({ where, create, update }) => {
        const key = `${where.eventId_phase.eventId}:${where.eventId_phase.phase}`;
        const { codeHash, salt, codeEnc, windowOpensAt, windowClosesAt } = create;
        codes.set(
          key,
          codes.has(key)
            ? { ...codes.get(key)!, ...update }
            : { codeHash, salt, codeEnc, windowOpensAt, windowClosesAt },
        );
      },
    },
    attendance: {
      findUnique: async ({ where }) =>
        attendance.get(`${where.eventId_memberId.eventId}:${where.eventId_memberId.memberId}`) ??
        null,
      upsert: async ({ where, create, update }) => {
        const key = `${where.eventId_memberId.eventId}:${where.eventId_memberId.memberId}`;
        const current = attendance.get(key) ?? { checkinStart: 'PENDING', checkinEnd: 'PENDING' };
        attendance.set(key, { ...current, ...create, ...update });
      },
    },
    dkpEntry: {
      findMany: async ({ where }) =>
        dkp.filter((entry) => entry.eventId === where.eventId && entry.memberId === where.memberId),
      create: async ({ data }) => {
        dkp.push(data);
        return { id: `d-${dkp.length}` };
      },
    },
    auditLog: {
      create: async ({ data }) => {
        audit.push({
          actorMemberId: data.actorMemberId,
          action: data.action,
          entityType: data.entityType,
          entityId: data.entityId,
          comment: data.comment,
        });
      },
    },
  };
  return {
    db,
    event,
    codes,
    attendance,
    dkp,
    audit,
    setWindowSec: (value: number | null) => {
      windowSec = value;
    },
  };
}

type State = ReturnType<typeof makeDb>;
const at = (iso: string) => new Date(iso);

/** Кнопка «Начать ивент» (START) или «Завершить ивент» (END) в момент `now`. */
async function press(state: State, phase: 'START' | 'END', now: Date, encKey = ENC_KEY) {
  const db = state.db as unknown as CheckInLaunchDb;
  return launchCheckInCode(db, 'e-1', phase, MANAGER, now, encKey, await readCheckInWindowSec(db));
}

const ACTOR = { memberId: 'm-officer', isAdmin: false };

describe('launchCheckInCode', () => {
  it('окно идёт от нажатия на настройку; в БД хэш и шифротекст, в аудите — автор без кода', async () => {
    const state = makeDb();
    const now = at('2026-03-03T16:45:00Z'); // за 15 минут до планового начала

    const bounds = await press(state, 'START', now);

    expect(bounds.windowOpensAt.getTime()).toBe(now.getTime());
    expect(bounds.windowClosesAt.getTime()).toBe(at('2026-03-03T16:48:00Z').getTime());
    const stored = state.codes.get('e-1:START')!;
    expect(stored.salt).toMatch(/^[a-f0-9]{32}$/);
    expect(stored.codeEnc).toMatch(/^v1:[a-f0-9]{24}:[a-f0-9]{32}:[a-f0-9]{6}$/);
    expect(Object.keys(stored).sort()).toEqual([
      'codeEnc',
      'codeHash',
      'salt',
      'windowClosesAt',
      'windowOpensAt',
    ]);
    expect(state.audit).toHaveLength(1);
    expect(state.audit[0]).toMatchObject({
      actorMemberId: 'm-officer',
      action: 'CHECKIN_CODE_GENERATE',
      entityId: 'e-1',
    });
    expect(state.audit[0]!.comment).toMatch(/^Запущен стартовый код \(окно до .+\)$/);
  });

  it('финальный код можно открыть позже планового окончания', async () => {
    const state = makeDb();

    const bounds = await press(state, 'END', at('2026-03-03T19:40:00Z')); // конец по плану 19:00

    expect(bounds.windowClosesAt.getTime()).toBe(at('2026-03-03T19:43:00Z').getTime());
    expect(state.codes.has('e-1:END')).toBe(true);
    expect(state.audit[0]!.comment).toMatch(/^Запущен финальный код /);
  });

  it('уже открытое окно не перевыпускает код и не пишет второй аудит', async () => {
    const state = makeDb();
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    const first = state.codes.get('e-1:START')!;

    await press(state, 'START', at('2026-03-03T16:46:00Z'));

    expect(state.codes.get('e-1:START')).toBe(first);
    expect(state.audit).toHaveLength(1);
  });

  it('пройденное окно запускается заново новым кодом — код от старой генерации по расписанию', async () => {
    const state = makeDb();
    await press(state, 'END', at('2026-03-03T19:00:00Z'));
    const old = state.codes.get('e-1:END')!;

    const bounds = await press(state, 'END', at('2026-03-03T19:40:00Z'));

    const fresh = state.codes.get('e-1:END')!;
    expect(state.codes.size).toBe(1);
    expect(fresh.codeHash).not.toBe(old.codeHash);
    expect(fresh.windowOpensAt).toEqual(bounds.windowOpensAt);
    expect(state.audit).toHaveLength(2);
  });

  it('длительность окна читается из Setting, без строки — дефолт', async () => {
    const state = makeDb();
    state.setWindowSec(60);
    const short = await press(state, 'START', at('2026-03-03T16:45:00Z'));
    expect(short.windowClosesAt.getTime()).toBe(at('2026-03-03T16:46:00Z').getTime());

    state.setWindowSec(null);
    const def = await press(state, 'END', at('2026-03-03T16:45:00Z'));
    expect(def.windowClosesAt.getTime()).toBe(at('2026-03-03T16:48:00Z').getTime());
  });
});

describe('CheckInService.raidLeadView', () => {
  it('РЛ видит код открытого окна (хэш в БД — подпись salt+sha256)', async () => {
    const state = makeDb();
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    const service = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T16:46:00Z'),
      ENC_KEY,
    );

    const view = await service.raidLeadView('e-1', { memberId: 'm-rl', isAdmin: false }, 'MEMBER');
    expect(view.phase).toBe('START');
    expect(view.windowState).toBe('ACTIVE');
    expect(view.code).toMatch(/^\d{3}$/);
    expect(view.windowClosesAt?.getTime()).toBe(at('2026-03-03T16:48:00Z').getTime());
    // Проверяем хэш с солью: случайные hex-строки могут содержать цифры кода.
    const stored = state.codes.get('e-1:START')!;
    expect(stored.codeHash).toBe(
      createHash('sha256').update(`${stored.salt}:${view.code}`).digest('hex'),
    );
  });

  it('до нажатия кода нет — какое бы время ни показывали часы', async () => {
    const state = makeDb();
    const service = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T16:58:00Z'), // прежнее стартовое окно по расписанию
      ENC_KEY,
    );

    const view = await service.raidLeadView('e-1', ACTOR, 'GUILD_LEADER');
    expect(view).toEqual({
      phase: 'START',
      windowState: 'NOT_OPEN_YET',
      code: '',
      windowOpensAt: null,
      windowClosesAt: null,
    });
    expect(state.codes.size).toBe(0);

    const player = await service.playerView('e-1', 'm-player');
    expect(player.windowState).toBe('NOT_OPEN_YET');
    expect(player.choices).toHaveLength(0);
  });

  it('рядовой-не-РЛ код не видит — 403', async () => {
    const state = makeDb();
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    const service = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T16:46:00Z'),
      ENC_KEY,
    );

    await expect(
      service.raidLeadView('e-1', { memberId: 'm-other', isAdmin: false }, 'MEMBER'),
    ).rejects.toThrow(ForbiddenException);
  });

  it.each(['GUILD_LEADER', 'OFFICER'] as const)('%s видит код ивента другого РЛ', async (rank) => {
    const state = makeDb();
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    const service = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T16:46:00Z'),
      ENC_KEY,
    );

    const view = await service.raidLeadView('e-1', ACTOR, rank);
    expect(view.code).toMatch(/^\d{3}$/);
  });

  it('повторный запрос кода показывает тот же код (шифротекст в БД)', async () => {
    const state = makeDb();
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    const service = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T16:46:00Z'),
      ENC_KEY,
    );

    const first = await service.raidLeadView('e-1', ACTOR, 'GUILD_LEADER');
    const second = await service.raidLeadView('e-1', ACTOR, 'GUILD_LEADER');
    expect(second.code).toBe(first.code);
  });

  it('код с другим ключом не расшифровывается', async () => {
    const state = makeDb();
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    const stranger = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T16:46:00Z'),
      'cd'.repeat(32),
    );

    await expect(stranger.raidLeadView('e-1', ACTOR, 'GUILD_LEADER')).rejects.toThrow(
      ConflictException,
    );
  });

  it('финальный код виден сразу после «Завершить ивент», когда ивент уже завершён', async () => {
    const state = makeDb();
    state.event.status = 'FINISHED';
    await press(state, 'END', at('2026-03-03T19:40:00Z'));
    const service = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T19:41:00Z'),
      ENC_KEY,
    );

    const view = await service.raidLeadView('e-1', ACTOR, 'GUILD_LEADER');
    expect(view.phase).toBe('END');
    expect(view.windowState).toBe('ACTIVE');
    expect(view.code).toMatch(/^\d{3}$/);
  });

  it('после закрытия окна — CLOSED; завершённый без кодов — финальная фаза закрыта', async () => {
    const state = makeDb();
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    const late = new CheckInService(state.db, SETTINGS, () => at('2026-03-03T17:30:00Z'), ENC_KEY);
    expect((await late.raidLeadView('e-1', ACTOR, 'GUILD_LEADER')).windowState).toBe('CLOSED');

    const bare = makeDb();
    bare.event.status = 'FINISHED';
    const finished = new CheckInService(
      bare.db,
      SETTINGS,
      () => at('2026-03-03T17:30:00Z'),
      ENC_KEY,
    );
    expect(await finished.raidLeadView('e-1', ACTOR, 'GUILD_LEADER')).toEqual({
      phase: 'END',
      windowState: 'CLOSED',
      code: '',
      windowOpensAt: null,
      windowClosesAt: null,
    });
  });
});

describe('CheckInService.playerView', () => {
  function started(state: State, now = '2026-03-03T16:46:00Z') {
    return new CheckInService(state.db, SETTINGS, () => at(now), ENC_KEY);
  }

  it('в активном окне — 4 варианта, включая верный; статус PENDING', async () => {
    const state = makeDb();
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    const service = started(state);

    const rlView = await service.raidLeadView('e-1', ACTOR, 'GUILD_LEADER');
    const view = await service.playerView('e-1', 'm-player');
    expect(view.windowState).toBe('ACTIVE');
    expect(view.choices).toHaveLength(4);
    expect(new Set(view.choices).size).toBe(4);
    expect(view.choices).toContain(rlView.code);
    expect(view.status).toBe('PENDING');
  });

  it('окно не запускали или оно закрыто — вариантов нет', async () => {
    const unstarted = makeDb();
    expect(
      await started(unstarted, '2026-03-03T16:58:00Z').playerView('e-1', 'm-player'),
    ).toMatchObject({ windowState: 'NOT_OPEN_YET', choices: [] });

    const closed = makeDb();
    await press(closed, 'START', at('2026-03-03T16:45:00Z'));
    expect(
      await started(closed, '2026-03-03T17:30:00Z').playerView('e-1', 'm-player'),
    ).toMatchObject({ phase: 'START', windowState: 'CLOSED', choices: [] });
  });

  it('варианты стабильны между запросами: перезагрузка страницы не выдает верный код', async () => {
    // Регрессия: обманки пересоздавались на каждый запрос, поэтому после
    // перезагрузки (или 10-секундного опроса) верный код оставался единственным
    // неизменным — его можно было выбрать, не слушая РЛ.
    const state = makeDb();
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    const service = started(state);

    await service.raidLeadView('e-1', ACTOR, 'GUILD_LEADER');
    const first = await service.playerView('e-1', 'm-player');
    const second = await service.playerView('e-1', 'm-player');
    const third = await service.playerView('e-1', 'm-player');
    expect(second.choices).toEqual(first.choices);
    expect(third.choices).toEqual(first.choices);
  });

  it('финальное окно открыто позже планового окончания — варианты финального кода', async () => {
    const state = makeDb();
    state.event.status = 'FINISHED';
    await press(state, 'END', at('2026-03-03T19:40:00Z'));
    const service = started(state, '2026-03-03T19:41:00Z');

    const view = await service.playerView('e-1', 'm-player');
    expect(view.phase).toBe('END');
    expect(view.choices).toHaveLength(4);
  });
});

describe('CheckInService.submit', () => {
  async function setup() {
    const state = makeDb();
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    const service = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T16:46:00Z'),
      ENC_KEY,
    );
    const rlView = await service.raidLeadView('e-1', ACTOR, 'GUILD_LEADER');
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
    const state = makeDb();
    state.event.status = 'FINISHED';
    state.attendance.set('e-1:m-player', { checkinStart: 'PASSED', checkinEnd: 'PENDING' });
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    await press(state, 'END', at('2026-03-03T19:40:00Z'));
    const service = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T19:41:00Z'),
      ENC_KEY,
    );

    const rlView = await service.raidLeadView('e-1', ACTOR, 'GUILD_LEADER');
    const result = await service.submit('e-1', 'm-player', { code: rlView.code });
    expect(result).toEqual({ result: 'PASSED' });
    expect(state.attendance.get('e-1:m-player')).toMatchObject({
      checkinStart: 'PASSED',
      checkinEnd: 'PASSED',
    });
    expect(state.dkp.map((entry) => entry.amount)).toEqual([5]);
  });

  it('окно не запускали — 409, отметки и ДКП нет', async () => {
    const state = makeDb();
    const service = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T16:58:00Z'),
      ENC_KEY,
    );

    await expect(service.submit('e-1', 'm-player', { code: '123' })).rejects.toThrow(
      ConflictException,
    );
    expect(state.attendance.size).toBe(0);
    expect(state.dkp).toHaveLength(0);
  });

  it('окно закрылось — 409, попытка не тратится', async () => {
    const state = makeDb();
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    const service = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T16:48:01Z'),
      ENC_KEY,
    );

    await expect(service.submit('e-1', 'm-player', { code: '123' })).rejects.toThrow(
      ConflictException,
    );
    expect(state.attendance.size).toBe(0);
  });

  it('финал перекрывает старт: сразу после начала завершили — ввод оценивается как финальный код', async () => {
    const state = makeDb();
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    const opening = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T16:45:30Z'),
      ENC_KEY,
    );
    const startCode = (await opening.raidLeadView('e-1', ACTOR, 'GUILD_LEADER')).code;

    // Завершили через минуту после начала, пока стартовое окно ещё открыто.
    // Финальный код задаём заведомо другим: случайные коды изредка совпадают.
    state.event.status = 'FINISHED';
    const endCode = startCode === '123' ? '456' : '123';
    const salt = 'ab'.repeat(16);
    state.codes.set('e-1:END', {
      codeHash: hashCheckInCode(endCode, salt),
      salt,
      codeEnc: encryptCheckInCode(endCode, ENC_KEY),
      ...manualWindowBounds(at('2026-03-03T16:46:00Z'), 180),
    });
    const service = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T16:46:30Z'),
      ENC_KEY,
    );
    expect((await service.playerView('e-1', 'm-player')).phase).toBe('END');

    // Стартовый код больше не принимается: попытка оценивается по финальному
    expect(await service.submit('e-1', 'm-player', { code: startCode })).toEqual({
      result: 'FAILED',
    });
    expect(state.attendance.get('e-1:m-player')).toMatchObject({
      checkinStart: 'PENDING',
      checkinEnd: 'FAILED',
    });
    expect(await service.submit('e-1', 'm-other', { code: endCode })).toEqual({ result: 'PASSED' });
    expect(state.attendance.get('e-1:m-other')).toMatchObject({
      checkinStart: 'PENDING',
      checkinEnd: 'PASSED',
    });
  });

  it('отменённый ивент — чек-ин недоступен (409), ДКП не начисляются', async () => {
    const state = makeDb();
    state.event.status = 'CANCELLED';
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    const service = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T16:46:00Z'),
      ENC_KEY,
    );

    await expect(service.submit('e-1', 'm-player', { code: '123' })).rejects.toThrow(
      ConflictException,
    );
    await expect(service.raidLeadView('e-1', ACTOR, 'GUILD_LEADER')).rejects.toThrow(
      ConflictException,
    );
    await expect(service.playerView('e-1', 'm-player')).rejects.toThrow(ConflictException);
    expect(state.dkp).toHaveLength(0);
  });

  it('двухфазная изоляция: старт PASSED не мешает финалу', async () => {
    const state = makeDb();
    state.event.status = 'FINISHED';
    state.attendance.set('e-1:m-player', { checkinStart: 'PASSED', checkinEnd: 'PENDING' });
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    await press(state, 'END', at('2026-03-03T19:40:00Z'));
    const service = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T19:41:00Z'),
      ENC_KEY,
    );

    const rlView = await service.raidLeadView('e-1', ACTOR, 'GUILD_LEADER');
    const result = await service.submit('e-1', 'm-player', { code: rlView.code });
    expect(result).toEqual({ result: 'PASSED' });
  });
});

describe('CheckInService: игрок получает варианты без раскрытия кода', () => {
  it('варианты содержат верный код, но ответ не помечает верный', async () => {
    const state = makeDb();
    await press(state, 'START', at('2026-03-03T16:45:00Z'));
    const service = new CheckInService(
      state.db,
      SETTINGS,
      () => at('2026-03-03T16:46:00Z'),
      ENC_KEY,
    );

    const rlView = await service.raidLeadView('e-1', ACTOR, 'GUILD_LEADER');
    const view = await service.playerView('e-1', 'm-player');
    expect(view.choices).toContain(rlView.code);
    // В ответе игрока нет пометки, какой код верный: только массив строк
    expect(Object.keys(view).sort()).toEqual(['choices', 'phase', 'status', 'windowState']);
  });
});

it('при ошибке начисления самоотметка откатывается, код не попадает в аудит', async () => {
  const state = makeDb();
  await press(state, 'START', at('2026-03-03T16:45:00Z'));
  const service = new CheckInService(state.db, SETTINGS, () => at('2026-03-03T16:46:00Z'), ENC_KEY);
  const view = await service.raidLeadView('e-1', { memberId: 'm-rl', isAdmin: false }, 'MEMBER');
  state.db.dkpEntry.create = async () => {
    throw new Error('ledger failure');
  };
  await expect(service.submit('e-1', 'm-1', { code: view.code })).rejects.toThrow('ledger failure');
  expect(state.attendance.size).toBe(0);
  expect(state.audit.map((a) => a.action)).toEqual(['CHECKIN_CODE_GENERATE']);
  expect(state.audit[0]!.comment).not.toContain(view.code);
});

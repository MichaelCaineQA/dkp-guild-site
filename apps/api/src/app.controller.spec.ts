import { AppController } from './app.controller';
import { PrismaService } from './prisma/prisma.service';

function makeController(queryRaw: () => Promise<unknown>): AppController {
  const prisma = { $queryRaw: queryRaw } as unknown as PrismaService;
  return new AppController(prisma);
}

describe('AppController', () => {
  it('health: ok и db=up при живой БД', async () => {
    const controller = makeController(() => Promise.resolve(1));
    const health = await controller.getHealth();
    expect(health.status).toBe('ok');
    expect(health.db).toBe('up');
  });

  it('health: db=down, если БД недоступна (health не падает)', async () => {
    const controller = makeController(() => Promise.reject(new Error('connection refused')));
    const health = await controller.getHealth();
    expect(health.status).toBe('ok');
    expect(health.db).toBe('down');
  });

  it('health: commit из GIT_SHA или null (контроль версии стенда, #175)', async () => {
    const controller = makeController(() => Promise.resolve(1));
    process.env.GIT_SHA = '  b450579abc  ';
    try {
      expect((await controller.getHealth()).commit).toBe('b450579abc');
    } finally {
      delete process.env.GIT_SHA;
    }
    expect((await controller.getHealth()).commit).toBeNull();
  });

  it('отдаёт справочник боевых ролей из @dkp/shared', () => {
    const controller = makeController(() => Promise.resolve(1));
    expect(controller.getCombatRoles()).toEqual({ DPS: 'ДД', HEALER: 'Хил', TANK: 'Танк' });
  });
});

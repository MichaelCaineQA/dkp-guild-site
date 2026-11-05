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

  it('отдаёт справочник боевых ролей из @dkp/shared', () => {
    const controller = makeController(() => Promise.resolve(1));
    expect(controller.getCombatRoles()).toEqual({ DPS: 'ДД', HEALER: 'Хил', TANK: 'Танк' });
  });
});

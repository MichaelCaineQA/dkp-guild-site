import { AppController } from './app.controller';

describe('AppController', () => {
  const controller = new AppController();

  it('health возвращает ok', () => {
    expect(controller.getHealth().status).toBe('ok');
  });

  it('отдаёт справочник боевых ролей из @dkp/shared', () => {
    expect(controller.getCombatRoles()).toEqual({ DPS: 'ДД', HEALER: 'Хил', TANK: 'Танк' });
  });
});

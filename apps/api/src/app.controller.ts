import { Controller, Get } from '@nestjs/common';
import { COMBAT_ROLE_LABELS } from '@dkp/shared';

@Controller()
export class AppController {
  @Get('health')
  getHealth(): { status: string; uptime: number } {
    return { status: 'ok', uptime: process.uptime() };
  }

  /** Справочник боевых ролей — заодно проверяет связку с @dkp/shared. */
  @Get('meta/combat-roles')
  getCombatRoles(): Record<string, string> {
    return COMBAT_ROLE_LABELS;
  }
}

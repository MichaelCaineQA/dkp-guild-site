import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { COMBAT_ROLE_LABELS } from '@dkp/shared';
import { AuthGuard } from './auth/auth.guard';
import { PermissionsGuard, RequirePermission } from './permissions/permissions.guard';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}

  /** Health отвечает всегда; доступность БД — отдельным полем (для мониторинга). */
  @Get('health')
  async getHealth(): Promise<{ status: string; db: 'up' | 'down'; uptime: number }> {
    let db: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      // БД недоступна — не роняем health, честно сигнализируем в поле db
    }
    return { status: 'ok', db, uptime: process.uptime() };
  }

  @Get('meta/guild')
  @Header('Cache-Control', 'private, no-store')
  @UseGuards(AuthGuard, PermissionsGuard)
  @RequirePermission('members.view_roster')
  async getGuild() {
    const guild = await this.prisma.guild.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { name: true, crest: true },
    });
    return { name: guild?.name ?? 'Гильдия', hasCrest: !!guild?.crest };
  }

  /** Справочник боевых ролей — заодно проверяет связку с @dkp/shared. */
  @Get('meta/combat-roles')
  getCombatRoles(): Record<string, string> {
    return COMBAT_ROLE_LABELS;
  }
}

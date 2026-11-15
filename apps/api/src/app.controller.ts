import { Controller, Get, Header, UseGuards } from '@nestjs/common';
import { COMBAT_ROLE_LABELS } from '@dkp/shared';
import { AuthGuard } from './auth/auth.guard';
import { PermissionsGuard, RequirePermission } from './permissions/permissions.guard';
import { PrismaService } from './prisma/prisma.service';

@Controller()
export class AppController {
  constructor(private readonly prisma: PrismaService) {}
  /**
   * Health отвечает всегда; доступность БД — отдельным полем (для мониторинга).
   * commit — короткий SHA сборки (GIT_SHA из deploy-окружения, аудит F13/#175:
   * контроль фактической версии на стенде); без переменной — null.
   */
  @Get('health')
  async getHealth(): Promise<{
    status: string;
    db: 'up' | 'down';
    uptime: number;
    commit: string | null;
  }> {
    let db: 'up' | 'down' = 'down';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      db = 'up';
    } catch {
      // БД недоступна — не роняем health, честно сигнализируем в поле db
    }
    return { status: 'ok', db, uptime: process.uptime(), commit: gitSha() };
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

  @Get('meta/guild-name')
  async getGuildName(): Promise<{ name: string | null }> {
    const guild = await this.prisma.guild.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { name: true },
    });
    return { name: guild?.name ?? null };
  }

  /** Справочник боевых ролей — заодно проверяет связку с @dkp/shared. */
  @Get('meta/combat-roles')
  getCombatRoles(): Record<string, string> {
    return COMBAT_ROLE_LABELS;
  }
}

/** SHA сборки из deploy-окружения; считывается один раз на процесс. */
function gitSha(): string | null {
  const sha = process.env.GIT_SHA?.trim();
  return sha ? sha : null;
}

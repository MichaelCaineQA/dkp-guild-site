import { randomBytes } from 'node:crypto';
import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { SETTING_DEFAULTS } from '@dkp/shared';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CheckInService, type CheckInDb, type CheckInSettings } from './checkin.service';

/**
 * Ключ AES для чек-ин кодов: в проде — env CHECKIN_ENC_KEY. Локально без
 * ключа — случайный на время жизни процесса: окна живут 3 минуты, потеря
 * при рестарте внутри окна редка и не страшна (прод задаёт ключ явно).
 */
const CHECKIN_ENC_KEY = process.env.CHECKIN_ENC_KEY || randomBytes(32).toString('hex');

/**
 * Чек-ин кодами (issue #9): игрок отмечается в карточке ивента, РЛ видит
 * код на странице проведения. Настройки окон читаются из БД на каждый
 * запрос — применяются без деплоя (issue #7).
 */
@Controller('events/:eventId/checkin')
@UseGuards(AuthGuard, PermissionsGuard)
export class CheckInController {
  constructor(private readonly prisma: PrismaService) {}

  /** Вид игрока: статус окна + 4 перемешанных варианта. */
  @Get('me')
  @RequirePermission('members.view_roster')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async playerView(@Param('eventId') eventId: string, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    const service = await this.makeService();
    return service.playerView(eventId, user.memberId!);
  }

  /**
   * Попытка ввода кода: жёсткий rate-limit поверх «одной попытки» —
   * защита от перебора 900 комбинаций (план 2.2).
   */
  @Post('me')
  @RequirePermission('members.view_roster')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async submit(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const user = req.session!.user!;
    const service = await this.makeService();
    return service.submit(eventId, user.memberId!, body);
  }

  /** Код — только РЛ ивента и офицерам+ (план 2.2). */
  @Get('code')
  @RequirePermission('members.view_roster')
  async raidLeadView(@Param('eventId') eventId: string, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    const service = await this.makeService();
    return service.raidLeadView(
      eventId,
      { memberId: user.memberId, isAdmin: user.isAdmin },
      user.rank,
    );
  }

  /** Досрочный финальный код (план 2.2 п.5): РЛ закончил раньше плана. */
  @Post('end-early')
  @RequirePermission('members.view_roster')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async startEndCodeEarly(@Param('eventId') eventId: string, @Req() req: AuthedRequest) {
    const user = req.session!.user!;
    const service = await this.makeService();
    const result = await service.startEndCodeEarly(
      eventId,
      { memberId: user.memberId, isAdmin: user.isAdmin },
      user.rank,
    );
    return result;
  }

  /** Сервис на запрос: свежие настройки окон из Setting + дефолты реестра. */
  private async makeService(): Promise<CheckInService> {
    const rows = await this.prisma.setting.findMany();
    const map = new Map<string, number>(rows.map((row) => [row.key, row.value as number]));
    const defaults = SETTING_DEFAULTS as Record<string, number>;
    // Ключи Setting с префиксом checkin. — см. SETTINGS_REGISTRY
    const pick = (key: string): number =>
      map.get(`checkin.${key}`) ?? defaults[`checkin.${key}`] ?? 0;
    const settings: CheckInSettings = {
      generateBeforeStartSec: pick('generateBeforeStartSec'),
      windowSec: pick('windowSec'),
      attempts: pick('attempts'),
      startSharePct: pick('startSharePct'),
      endSharePct: pick('endSharePct'),
    };
    return new CheckInService(
      this.prisma as unknown as CheckInDb,
      settings,
      () => new Date(),
      CHECKIN_ENC_KEY,
    );
  }
}

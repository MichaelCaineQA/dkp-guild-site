import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { SETTING_DEFAULTS } from '@dkp/shared';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { SessionThrottle } from '../auth/session-throttle';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { PrismaService } from '../prisma/prisma.service';
import { CheckInService, type CheckInDb, type CheckInSettings } from './checkin.service';
import { CHECKIN_ENC_KEY } from './enc-key';

/**
 * Чек-ин кодами (issue #9): игрок отмечается в карточке ивента, управляющий
 * видит код на странице проведения. Окна кодов открывают кнопки «Начать
 * ивент» и «Завершить ивент» (смена статуса, решение №23); настройки долей
 * платы читаются из БД на каждый запрос — применяются без деплоя (issue #7).
 */
@Controller('events/:eventId/checkin')
@UseGuards(AuthGuard, PermissionsGuard)
export class CheckInController {
  constructor(private readonly prisma: PrismaService) {}

  /** Вид игрока: статус окна + 4 перемешанных варианта. */
  @Get('me')
  @RequirePermission('members.view_roster')
  @SessionThrottle(30)
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
  @SessionThrottle(10)
  async submit(
    @Param('eventId') eventId: string,
    @Body() body: unknown,
    @Req() req: AuthedRequest,
  ) {
    const user = req.session!.user!;
    const service = await this.makeService();
    return service.submit(eventId, user.memberId!, body);
  }

  /** Код — только управляющим ивента (план 2.2). */
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

  /** Сервис на запрос: свежие доли платы из Setting + дефолты реестра. */
  private async makeService(): Promise<CheckInService> {
    const rows = await this.prisma.setting.findMany();
    const map = new Map<string, number>(rows.map((row) => [row.key, row.value as number]));
    const defaults = SETTING_DEFAULTS as Record<string, number>;
    // Ключи Setting с префиксом checkin. — см. SETTINGS_REGISTRY
    const pick = (key: string): number =>
      map.get(`checkin.${key}`) ?? defaults[`checkin.${key}`] ?? 0;
    const settings: CheckInSettings = {
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

import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { type SessionUser } from '@dkp/shared';
import { AuthService } from './auth.service';
import { AuthGuard, MinRank, type AuthedRequest } from './auth.guard';
import { LinkRequestService } from './link-request.service';
import { performTestLogin } from './test-login';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditInterceptor } from '../audit/audit.interceptor';

const WEB_URL = process.env.WEB_URL ?? 'http://localhost:3000';

@Controller('auth')
@UseInterceptors(AuditInterceptor)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly linkRequests: LinkRequestService,
    private readonly audit: AuditService,
  ) {}

  /** Запуск Discord OAuth2 — редирект на discord.com. */
  @Get('discord')
  @UseGuards(PassportAuthGuard('discord'))
  discordLogin(): void {
    // passport сам редиректит на Discord
  }

  /** Возврат с Discord: стратегия уже прогнала логику входа, кладём в сессию. */
  @Get('discord/callback')
  @UseGuards(PassportAuthGuard('discord'))
  async discordCallback(@Req() req: AuthedRequest, @Res() res: Response): Promise<void> {
    // req.user — SessionUser, собранный DiscordStrategy.validate
    const user = req.user as SessionUser;
    await this.audit.record({
      actorMemberId: user.memberId,
      action: 'LOGIN_DISCORD',
      entityType: 'User',
      entityId: user.userId,
      comment: 'Вход через Discord',
    });
    req.session!.user = user;
    void req.session!.save(() => res.redirect(`${WEB_URL}/`));
  }

  /** Текущий пользователь (ранг/привязка перечитываются из БД). */
  @Get('me')
  @UseGuards(AuthGuard)
  async me(@Req() req: AuthedRequest) {
    const fresh = await this.authService.getSessionUser(req.session!.user!.userId);
    if (fresh) {
      req.session!.user = fresh;
    }
    return { user: req.session!.user };
  }

  /** Резервный вход администратора (login-пароль из env). */
  @Post('admin/login')
  @AuditAction({ action: 'LOGIN_ADMIN', entityType: 'User', comment: 'Вход администратора' })
  @Throttle({ default: { limit: 5, ttl: 15 * 60_000 } })
  @HttpCode(200)
  adminLogin(
    @Body() body: { login?: string; password?: string },
    @Req() req: AuthedRequest,
  ): { ok: boolean } {
    const login = body.login ?? '';
    const password = body.password ?? '';
    if (
      !this.authService.isAdminCredentials(login, password, {
        login: process.env.ADMIN_LOGIN,
        password: process.env.ADMIN_PASSWORD,
      })
    ) {
      return { ok: false };
    }
    // Синтетическая сессия админа: без Member, isAdmin=true (высшие права в AuthGuard)
    req.session!.user = {
      userId: `admin:${login}`,
      username: login,
      memberId: null,
      rank: null,
      isAdmin: true,
    };
    return { ok: true };
  }

  @Post('logout')
  logout(@Req() req: AuthedRequest, @Res() res: Response): void {
    req.session!.destroy(() => {
      res.clearCookie('dkp.sid');
      res.json({ ok: true });
    });
  }

  /**
   * Тестовый вход для e2e и ручной проверки ролей (issue #20): выдаёт
   * обычную сессионную cookie. Доступен только при AUTH_TEST_MODE=true —
   * иначе ручка отвечает 404, как будто её нет.
   */
  @Post('test-login')
  @AuditAction({ action: 'LOGIN_TEST', entityType: 'User', comment: 'Тестовый вход' })
  @HttpCode(200)
  testLogin(
    @Body() body: { username?: string },
    @Req() req: AuthedRequest,
  ): { ok: boolean; error?: string } {
    const result = performTestLogin(body, process.env.AUTH_TEST_MODE);
    if (result.error === 'NOT_FOUND') {
      throw new NotFoundException();
    }
    if (result.ok && result.user) {
      // Роль/Member лежат в БД (pnpm db:seed:test), /auth/me перечитает их.
      req.session!.user = result.user;
    }
    return { ok: result.ok, error: result.error };
  }

  /** Заявка на привязку своего Discord к нику члена гильдии. */
  @Post('link-request')
  @AuditAction({
    action: 'LINK_REQUEST_CREATE',
    entityType: 'User',
    comment: 'Заявка на привязку Discord',
  })
  @UseGuards(AuthGuard)
  createLinkRequest(@Body() body: unknown, @Req() req: AuthedRequest) {
    return this.linkRequests.create(req.session!.user!.userId, body);
  }

  /** Очередь заявок — Главе и Админу. */
  @Get('link-requests')
  @MinRank('GUILD_LEADER')
  @UseGuards(AuthGuard)
  listLinkRequests() {
    return this.linkRequests.listPending();
  }

  /** Подтвердить заявку — Главе и Админу. */
  @Post('link-requests/:id/approve')
  @AuditAction({
    action: 'LINK_REQUEST_APPROVE',
    entityType: 'MemberLinkRequest',
    comment: 'Привязка Discord подтверждена',
  })
  @MinRank('GUILD_LEADER')
  @UseGuards(AuthGuard)
  approveLinkRequest(@Param('id') id: string) {
    return this.linkRequests.approve(id);
  }

  /** Отклонить заявку — Главе и Админу. */
  @Post('link-requests/:id/reject')
  @AuditAction({
    action: 'LINK_REQUEST_REJECT',
    entityType: 'MemberLinkRequest',
    comment: 'Привязка Discord отклонена',
  })
  @MinRank('GUILD_LEADER')
  @UseGuards(AuthGuard)
  rejectLinkRequest(@Param('id') id: string) {
    return this.linkRequests.reject(id);
  }
}

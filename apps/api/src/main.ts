import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import passport from 'passport';
import { AppModule } from './app.module';
import { setupOpenApi } from './openapi/openapi';
import { createSessionMiddleware } from './auth/session';

async function bootstrap(): Promise<void> {
  // Тестовый вход (/auth/test-login) — только для dev/staging/e2e.
  // Если флаг забыли выключить на проде — падаем сразу, а не отдаём
  // «войдите кем угодно» наружу.
  if (process.env.NODE_ENV === 'production' && process.env.AUTH_TEST_MODE === 'true') {
    throw new Error('AUTH_TEST_MODE включён в production — тестовый вход запрещён');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // За Caddy доверяем только непосредственно подключённому прокси.
  if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

  // httpOnly-cookie сессия: единая для API, SSR-страниц Next и Socket.IO
  // (план 2.9, issue #97) — store (Redis при REDIS_URL) в ./auth/session.
  app.use(createSessionMiddleware());
  app.use(passport.initialize());
  // passport.session() не нужен: сессию ведём сами (req.session.user),
  // сериализация passport не используется.

  app.enableCors({
    origin: process.env.WEB_URL ?? 'http://localhost:3000',
    credentials: true,
  });
  app.enableShutdownHooks();
  setupOpenApi(app);
  await app.listen(process.env.PORT ?? 3001);
}
void bootstrap();

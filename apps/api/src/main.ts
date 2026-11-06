import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import session from 'express-session';
import passport from 'passport';
import { AppModule } from './app.module';
import { setupOpenApi } from './openapi/openapi';

async function bootstrap(): Promise<void> {
  // Тестовый вход (/auth/test-login) — только для dev/staging/e2e.
  // Если флаг забыли выключить на проде — падаем сразу, а не отдаём
  // «войдите кем угодно» наружу.
  if (process.env.NODE_ENV === 'production' && process.env.AUTH_TEST_MODE === 'true') {
    throw new Error('AUTH_TEST_MODE включён в production — тестовый вход запрещён');
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // httpOnly-cookie сессия: единая для API и SSR-страниц Next (план 2.9).
  app.use(
    session({
      name: 'dkp.sid',
      secret: process.env.SESSION_SECRET ?? 'dev-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        // Secure по умолчанию в проде; COOKIE_SECURE=false — для запуска
        // в контейнере по http://localhost (docker compose, см. docker-compose.yml)
        secure: process.env.COOKIE_SECURE
          ? process.env.COOKIE_SECURE === 'true'
          : process.env.NODE_ENV === 'production',
        maxAge: 30 * 24 * 60 * 60 * 1000, // 30 дней
      },
    }),
  );
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

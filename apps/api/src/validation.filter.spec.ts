import 'reflect-metadata';
import { Controller, Get, Module, Query, type INestApplication } from '@nestjs/common';
import { APP_FILTER, NestFactory } from '@nestjs/core';
import { eventsQuerySchema, dkpQuerySchema, lootLogQuerySchema } from '@dkp/shared';
import { ValidationFilter } from './validation.filter';

@Controller()
class QueriesController {
  @Get('events') events(@Query() query: unknown) {
    return eventsQuerySchema.parse(query);
  }
  @Get('dkp') dkp(@Query() query: unknown) {
    return dkpQuerySchema.parse(query);
  }
  @Get('loot') loot(@Query() query: unknown) {
    return lootLogQuerySchema.parse(query);
  }
  @Get('unexpected') unexpected() {
    throw new Error('unexpected');
  }
}
@Module({
  controllers: [QueriesController],
  providers: [{ provide: APP_FILTER, useClass: ValidationFilter }],
})
class TestModule {}

describe('Ошибки входных схем через HTTP', () => {
  let app: INestApplication;
  let url: string;
  beforeAll(async () => {
    app = await NestFactory.create(TestModule, { logger: false });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });
  afterAll(async () => {
    await app.close();
  });
  it.each([
    '/events?from=broken',
    '/dkp?limit=abc',
    '/loot?limit=abc',
    '/dkp?limit=0',
    '/loot?limit=-1',
  ])('%s возвращает одинаковую ошибку 400 с полями', async (path) => {
    const response = await fetch(url + path);
    expect(response.status).toBe(400);
    const body = (await response.json()) as {
      statusCode: number;
      error: string;
      errors: { path: unknown[]; code: string; message: string }[];
    };
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(Array.isArray(body.errors[0].path)).toBe(true);
    expect(typeof body.errors[0].code).toBe('string');
    expect(typeof body.errors[0].message).toBe('string');
  });
  it('не превращает неожиданный сбой в ошибку клиента', async () => {
    expect((await fetch(url + '/unexpected')).status).toBe(500);
  });
});

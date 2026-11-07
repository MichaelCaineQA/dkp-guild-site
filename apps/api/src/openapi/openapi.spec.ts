import 'reflect-metadata';
import { Module, type INestApplication, type Type } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { OpenAPIObject, OperationObject, SchemaObject } from '@nestjs/swagger';
import { createApiDocument, setupOpenApi } from './openapi';
import { contracts } from './contracts';
import { schemas } from './schemas';
import { WEAPONS, weaponPairSchema } from '@dkp/shared';

jest.mock('@nestjs/passport', () => ({ AuthGuard: () => class {} }));

// Обнаруживаем реальные контроллеры: новый маршрут должен получить контракт.
function controllersIn(directory: string): Type[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return controllersIn(path);
    if (!entry.name.endsWith('.controller.ts')) return [];
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return Object.values(require(path)).filter(
      (value) => typeof value === 'function' && Reflect.getMetadata('__controller__', value),
    ) as Type[];
  });
}
const controllers = controllersIn(join(__dirname, '..'));
const tokens = new Set<Type>(
  controllers.flatMap((controller) => Reflect.getMetadata('design:paramtypes', controller) ?? []),
);
@Module({ controllers, providers: [...tokens].map((provide) => ({ provide, useValue: {} })) })
class ContractModule {}

describe('Контракт OpenAPI', () => {
  let app: INestApplication;
  let document: OpenAPIObject;
  beforeAll(async () => {
    app = await NestFactory.create(ContractModule, { logger: false });
    document = createApiDocument(app, true);
  });
  afterAll(async () => {
    await app?.close();
  });

  it('описывает каждый текущий маршрут, запрос и успешный ответ', () => {
    const ids: string[] = [];
    for (const item of Object.values(document.paths)) {
      for (const method of ['get', 'post', 'put', 'patch', 'delete'] as const) {
        const operation = item[method] as OperationObject | undefined;
        if (!operation) continue;
        ids.push(operation.operationId!);
        expect(operation.summary).toBeTruthy();
        expect(operation.tags).toHaveLength(1);
        const success = Object.entries(operation.responses).find(
          ([status]) => Number(status) < 400,
        )!;
        expect(success).toBeDefined();
        const contract = contracts[operation.operationId!];
        if (Number(success[0]) !== 302)
          expect(success[1]).toHaveProperty(
            `content.${contract.responseTypes?.[0] ?? 'application/json'}.schema`,
          );
        if (contract.body)
          expect(operation.requestBody).toHaveProperty(
            `content.${contract.bodyType ?? 'application/json'}.schema.$ref`,
            `#/components/schemas/${contract.body}`,
          );
      }
    }
    expect(ids.sort()).toEqual(Object.keys(contracts).sort());
  });

  it('контракт анкеты описывает приватные файлы и удалённые ручные операции', () => {
    expect(document.paths['/screenshots'].post!.requestBody).toHaveProperty(
      'content.multipart/form-data.schema',
    );
    expect(document.paths['/screenshots/{id}'].get!.responses['200']).toHaveProperty(
      'content.image/png.schema.format',
      'binary',
    );
    expect(document.paths['/members'].post).toBeUndefined();
    expect(document.paths['/auth/link-requests/{id}/reject']).toBeUndefined();
    expect(schemas.CreateLinkRequest.required).toEqual(
      expect.arrayContaining(['gearScore', 'screenshotIds']),
    );
  });

  it('все ссылки на схемы разрешаются', () => {
    function visit(value: unknown): void {
      if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) {
        if (key === '$ref') {
          expect(child).toMatch(/^#\/components\/schemas\//);
          expect(document.components?.schemas).toHaveProperty(String(child).split('/').at(-1)!);
        } else visit(child);
      }
    }
    visit(document);
  });

  it('передаёт ограничения общей валидации и оружие RU', () => {
    const pair = schemas.UpdateOwnProfile.properties!.weapons as SchemaObject;
    expect(weaponPairSchema.safeParse(pair.example).success).toBe(true);
    expect(pair).toMatchObject({
      minItems: 2,
      maxItems: 2,
      uniqueItems: true,
      items: { enum: [...WEAPONS] },
    });
    expect(schemas.UpdateOwnProfile.additionalProperties).toBe(false);
    expect(schemas.SubmitCheckIn.properties!.code).toMatchObject({ pattern: '^\\d{3}$' });
    expect(schemas.CreateEvent.properties!.startsAt).toMatchObject({
      type: 'string',
      format: 'date-time',
    });
    expect(schemas.ManualDkp.properties!.amount).toMatchObject({ not: { enum: [0] } });
    expect(schemas.UpdateSettings.additionalProperties).toBe(false);
  });

  it('разделяет публичные и сессионные методы и скрывает выключенный тестовый вход', () => {
    expect(document.paths['/health'].get!.security).toEqual([]);
    expect(document.paths['/health'].get!.description).toContain('без авторизации');
    expect(document.paths['/members'].get!.security).toEqual([{ session: [] }]);
    expect(document.components?.securitySchemes?.session).toMatchObject({
      type: 'apiKey',
      in: 'cookie',
      name: 'dkp.sid',
    });
    expect(createApiDocument(app, false).paths['/auth/test-login']).toBeUndefined();
  });

  it('публикует Swagger UI и JSON через HTTP', async () => {
    setupOpenApi(app);
    await app.listen(0, '127.0.0.1');
    const port = (app.getHttpServer().address() as AddressInfo).port;
    const base = `http://127.0.0.1:${port}`;
    const json = await fetch(`${base}/openapi.json`);
    expect(json.status).toBe(200);
    expect(await json.json()).toMatchObject({
      openapi: '3.0.0',
      info: { title: 'ДКП гильдии — API' },
    });
    const ui = await fetch(`${base}/docs`);
    expect(ui.status).toBe(200);
    expect(await ui.text()).toContain('swagger-ui');
    expect((await fetch(`${base}/docs/swagger-ui-init.js`)).status).toBe(200);
  });
});

import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type {
  OpenAPIObject,
  OperationObject,
  ParameterObject,
  SchemaObject,
} from '@nestjs/swagger';
import { contracts, extraSchemas } from './contracts';
import { ref, schemas } from './schemas';

const methods = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head'] as const;

export function createApiDocument(
  app: INestApplication,
  testMode = process.env.AUTH_TEST_MODE === 'true',
): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('ДКП гильдии — API')
    .setDescription(
      'Контракт текущего HTTP API. Даты передаются в ISO 8601 с часовым поясом (рекомендуется UTC, суффикс Z). ' +
        'Авторизация: сначала войдите через Discord (/auth/discord) или резервного администратора в этом же браузере. ' +
        'HttpOnly-cookie dkp.sid отправляется браузером автоматически; вводить её в Authorize не требуется. ' +
        'Личные операции требуют привязки Discord к участнику. Оружие соответствует RU-серверу. ' +
        'Общий лимит — 100 запросов в минуту; отдельные методы имеют более строгие лимиты. ' +
        'Не все обработчики Zod преобразуют ошибки в HTTP 400: в существующем API возможен HTTP 500 при неверном вводе.',
    )
    .setVersion('0.1.0')
    .addCookieAuth(
      'dkp.sid',
      { type: 'apiKey', in: 'cookie', description: 'Сессионная httpOnly-cookie после входа.' },
      'session',
    )
    .build();
  const document = SwaggerModule.createDocument(app, config, {
    operationIdFactory: (controller, method) =>
      `${controller.replace(/Controller$/, '')}_${method}`,
  });
  document.components = { ...document.components, schemas: { ...schemas, ...extraSchemas } };
  for (const [path, item] of Object.entries(document.paths)) {
    for (const method of methods) {
      const operation = item[method] as OperationObject | undefined;
      if (!operation) continue;
      if (operation.operationId === 'Auth_testLogin' && !testMode) {
        delete item[method];
        continue;
      }
      const contract = contracts[operation.operationId ?? ''];
      if (!contract) throw new Error(`Нет OpenAPI-контракта: ${operation.operationId}`);
      operation.summary = contract.summary;
      operation.description = [
        contract.public
          ? 'Доступ: без авторизации.'
          : contract.access && `Доступ: ${contract.access}`,
        contract.description,
      ]
        .filter(Boolean)
        .join('\n\n');
      operation.tags = [tagFor(path)];
      operation.security = contract.public ? [] : [{ session: [] }];
      const success = contract.status ?? Number(Object.keys(operation.responses)[0]);
      operation.responses = {
        [success]: {
          description: success === 302 ? 'Перенаправление' : 'Успешный ответ',
          ...(contract.response
            ? {
                content: Object.fromEntries(
                  (contract.responseTypes ?? ['application/json']).map((type) => [
                    type,
                    { schema: contract.response },
                  ]),
                ),
              }
            : {}),
          ...(success === 302
            ? {
                headers: {
                  Location: { description: 'Адрес перенаправления', schema: { type: 'string' } },
                },
              }
            : {}),
        },
      };
      const errors = new Set([
        429,
        500,
        ...(contract.public ? [] : [401, 403]),
        ...(contract.errors ?? []),
      ]);
      const descriptions: Record<number, string> = {
        400: 'Некорректный запрос',
        401: 'Требуется вход или недостаточный ранг',
        403: 'Недостаточно прав',
        404: 'Ресурс не найден или метод отключён',
        413: 'Файл слишком большой',
        409: 'Конфликт состояния или нарушение ограничений',
        429: 'Превышен лимит запросов',
        500: 'Ошибка сервера (в том числе необработанная ошибка валидации)',
      };
      for (const code of errors)
        operation.responses[code] = {
          description: descriptions[code],
          content: { 'application/json': { schema: ref('Error') } },
        };
      if (contract.body)
        operation.requestBody = {
          required: true,
          content: { [contract.bodyType ?? 'application/json']: { schema: ref(contract.body) } },
        };
      const parameters = (operation.parameters ?? []) as ParameterObject[];
      for (const param of parameters) {
        if (param.in !== 'path') continue;
        param.description =
          param.name === 'slug' ? 'Страница правил' : `Идентификатор: ${param.name}`;
        param.schema =
          param.name === 'slug'
            ? { type: 'string', enum: ['guild-rules', 'site-rules'] }
            : param.name === 'version'
              ? { type: 'integer', minimum: 1 }
              : { type: 'string', minLength: 1 };
      }
      if (contract.query) {
        const schema = document.components.schemas![contract.query] as SchemaObject;
        for (const [name, value] of Object.entries(schema.properties ?? {}))
          parameters.push({
            name,
            in: 'query',
            required: schema.required?.includes(name) ?? false,
            schema: value,
            description: (value as SchemaObject).description ?? `Фильтр: ${name}`,
          });
      }
      operation.parameters = parameters;
    }
    if (!methods.some((method) => item[method])) delete document.paths[path];
  }
  return document;
}

function tagFor(path: string): string {
  if (path.includes('/checkin')) return 'Чек-ин';
  if (path.includes('/conduct')) return 'Проведение ивента';
  const tags: Record<string, string> = {
    dashboard: 'Дашборд',
    auth: 'Авторизация и привязка Discord',
    members: 'Состав гильдии',
    events: 'Расписание',
    absences: 'Отсутствия',
    dkp: 'ДКП',
    audit: 'Аудит',
    profiles: 'Профили',
    rules: 'Правила',
    settings: 'Настройки',
    'event-types': 'Типы ивентов',
    items: 'Аукцион',
    health: 'Система',
    meta: 'Система',
  };
  return tags[path.split('/')[1]] ?? 'Система';
}

export function setupOpenApi(app: INestApplication): void {
  SwaggerModule.setup('docs', app, createApiDocument(app), {
    jsonDocumentUrl: '/openapi.json',
    raw: ['json'],
    customSiteTitle: 'Контракт API ДКП',
    swaggerOptions: {
      withCredentials: true,
      displayRequestDuration: true,
      docExpansion: 'none',
      persistAuthorization: false,
      validatorUrl: null,
    },
  });
}

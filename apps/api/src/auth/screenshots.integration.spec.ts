import 'reflect-metadata';
import { Module, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { Request, Response, NextFunction } from 'express';
import type { SessionUser } from '@dkp/shared';
import { SCREENSHOT_MAX_BYTES } from '@dkp/shared';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { ScreenshotsController } from './screenshots.controller';
import { ScreenshotsService, type ScreenshotDb } from './screenshots.service';
let actor: SessionUser | undefined;
const files = new Map<string, { id: string; userId: string; mime: string }>();
const metadata = {
  create: jest.fn(async ({ data }: { data: { id: string; userId: string; mime: string } }) => {
    files.set(data.id, data);
    return data;
  }),
  findUnique: jest.fn(async ({ where }: { where: { id: string } }) => files.get(where.id) ?? null),
};
const audit = jest.fn(async () => ({}));
const db = {
  user: { findUnique: jest.fn(async () => ({ discordId: 'discord' })) },
  screenshot: metadata,
  $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
    work({ screenshot: metadata, auditLog: { create: audit } }),
};
@Module({
  controllers: [ScreenshotsController],
  providers: [
    {
      provide: ScreenshotsService,
      useFactory: () => new ScreenshotsService(db as unknown as ScreenshotDb),
    },
  ],
})
class TestModule {}
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jQ1sAAAAASUVORK5CYII=',
  'base64',
);
describe('Приватные скриншоты через HTTP', () => {
  let app: INestApplication;
  let url: string;
  let directory: string;
  beforeAll(async () => {
    directory = await mkdtemp(join(tmpdir(), 'dkp-onboarding-'));
    process.env.SCREENSHOT_DIR = directory;
    app = await NestFactory.create(TestModule, { logger: false });
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, { session: { user: actor } });
      next();
    });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });
  afterAll(async () => {
    await app?.close();
    delete process.env.SCREENSHOT_DIR;
    if (basename(directory).startsWith('dkp-onboarding-'))
      await rm(directory, { recursive: true, force: true });
  });
  beforeEach(() => {
    actor = { userId: 'owner', username: 'Новый', rank: null, memberId: null, isAdmin: false };
    jest.clearAllMocks();
  });
  const upload = (data: Buffer = png, type = 'image/png') => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(data)], { type }), 'профиль.png');
    return fetch(url + '/screenshots', { method: 'POST', body: form });
  };
  it('аноним не загружает и не скачивает', async () => {
    actor = undefined;
    expect((await upload()).status).toBe(401);
    expect((await fetch(url + '/screenshots/11111111-1111-4111-8111-111111111111')).status).toBe(
      401,
    );
    expect(metadata.create).not.toHaveBeenCalled();
  });
  it('владелец и Глава/Админ открывают файл, рядовой/Офицер/непринятый чужой — нет', async () => {
    const result = await upload();
    expect(result.status).toBe(201);
    const { id } = (await result.json()) as { id: string };
    const read = await fetch(`${url}/screenshots/${id}`);
    expect(read.status).toBe(200);
    expect(read.headers.get('content-type')).toContain('image/png');
    expect(read.headers.get('cache-control')).toBe('private, no-store');
    expect(Buffer.from(await read.arrayBuffer())).toEqual(png);
    for (const rank of [null, 'MEMBER', 'OFFICER'] as const) {
      actor = {
        userId: 'other',
        username: 'Другой',
        rank,
        memberId: rank ? 'other-member' : null,
        isAdmin: false,
      };
      expect((await fetch(`${url}/screenshots/${id}`)).status).toBe(404);
    }
    actor!.rank = 'GUILD_LEADER';
    expect((await fetch(`${url}/screenshots/${id}`)).status).toBe(200);
    actor = { userId: 'admin:a', username: 'a', rank: null, memberId: null, isAdmin: true };
    expect((await fetch(`${url}/screenshots/${id}`)).status).toBe(200);
    expect(audit).toHaveBeenCalledTimes(1);
  });
  it('ровно 10 МБ допустимо, больше — нет', async () => {
    const exact = Buffer.alloc(SCREENSHOT_MAX_BYTES);
    png.copy(exact);
    expect((await upload(exact)).status).toBe(201);
    const tooBig = Buffer.alloc(SCREENSHOT_MAX_BYTES + 1);
    png.copy(tooBig);
    expect((await upload(tooBig)).status).toBe(413);
    expect(metadata.create).toHaveBeenCalledTimes(1);
  });
  it('не доверяет расширению и MIME; SVG и пустой файл отклоняются', async () => {
    for (const [data, type] of [
      [Buffer.from('<svg/>'), 'image/png'],
      [png, 'text/html'],
      [Buffer.alloc(0), 'image/png'],
    ] as const)
      expect((await upload(data, type)).status).toBe(400);
    expect(metadata.create).not.toHaveBeenCalled();
  });
  it('распознаёт допустимые сигнатуры JPEG и WebP', async () => {
    expect((await upload(Buffer.from([255, 216, 255, 224, 0]), 'image/jpeg')).status).toBe(201);
    expect((await upload(Buffer.from('RIFF0000WEBPVP8 0000'), 'image/webp')).status).toBe(201);
  });
  it('пустой multipart не пишет метаданные', async () => {
    expect(
      (await fetch(url + '/screenshots', { method: 'POST', body: new FormData() })).status,
    ).toBe(400);
    expect(metadata.create).not.toHaveBeenCalled();
  });
});

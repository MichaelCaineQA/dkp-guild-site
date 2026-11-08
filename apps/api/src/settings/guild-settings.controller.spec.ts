import sharp from 'sharp';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuthedRequest } from '../auth/auth.guard';
import { GuildSettingsController } from './guild-settings.controller';

describe('Настройки гильдии', () => {
  const update = jest.fn(async () => ({}));
  const audit = jest.fn(async () => ({}));
  const tx = {
    guild: { findFirst: async () => ({ id: 'g', name: 'Старое', crest: null }), update },
    auditLog: { create: audit },
  };
  const db = { $transaction: async (work: (value: typeof tx) => unknown) => work(tx) };
  const service = new GuildSettingsController(db as unknown as PrismaService);
  const req = {
    session: { user: { memberId: 'leader', isAdmin: false } },
  } as unknown as AuthedRequest;
  beforeEach(() => {
    jest.clearAllMocks();
  });
  it('сохраняет прозрачный PNG и название вместе с аудитом', async () => {
    const buffer = await sharp({
      create: { width: 4, height: 4, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    await expect(
      service.update(' Новое ', { buffer, size: buffer.length, mimetype: 'image/png' }, req),
    ).resolves.toEqual({ name: 'Новое', hasCrest: true });
    expect(update).toHaveBeenCalledTimes(1);
    expect(audit).toHaveBeenCalledTimes(1);
  });
  it('отклоняет непрозрачный или повреждённый файл и пустое название', async () => {
    const buffer = await sharp({ create: { width: 4, height: 4, channels: 3, background: 'red' } })
      .png()
      .toBuffer();
    await expect(
      service.update('Имя', { buffer, size: buffer.length, mimetype: 'image/png' }, req),
    ).rejects.toThrow();
    await expect(
      service.update('Имя', { buffer: Buffer.from('bad'), size: 3, mimetype: 'image/png' }, req),
    ).rejects.toThrow();
    await expect(service.update(' ', undefined, req)).rejects.toThrow();
    expect(update).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});

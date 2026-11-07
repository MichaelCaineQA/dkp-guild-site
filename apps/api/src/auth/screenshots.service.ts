import {
  BadRequestException,
  Injectable,
  NotFoundException,
  PayloadTooLargeException,
  StreamableFile,
} from '@nestjs/common';
import { can, SCREENSHOT_MAX_BYTES, type SessionUser } from '@dkp/shared';
import type { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
export interface ScreenshotFile {
  buffer: Buffer;
  size: number;
  mimetype: string;
}
export type ScreenshotDb = Pick<PrismaClient, 'screenshot' | 'user' | '$transaction'>;
export function imageMime(data: Buffer): string | null {
  if (
    data.length >= 24 &&
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
    data.toString('ascii', 12, 16) === 'IHDR'
  )
    return 'image/png';
  if (data.length >= 4 && data[0] === 255 && data[1] === 216 && data[2] === 255)
    return 'image/jpeg';
  if (
    data.length >= 16 &&
    data.toString('ascii', 0, 4) === 'RIFF' &&
    data.toString('ascii', 8, 12) === 'WEBP' &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(data.toString('ascii', 12, 16))
  )
    return 'image/webp';
  return null;
}
@Injectable()
export class ScreenshotsService {
  private readonly directory = resolve(process.env.SCREENSHOT_DIR ?? 'uploads/screenshots');
  constructor(private readonly db: ScreenshotDb) {}
  async upload(userId: string, file?: ScreenshotFile) {
    if (file && file.size > SCREENSHOT_MAX_BYTES)
      throw new PayloadTooLargeException('Скриншот должен быть до 10 МБ включительно');
    if (!file || !file.buffer.length)
      throw new BadRequestException('Файл PNG, JPG или WebP до 10 МБ обязателен');
    const mime = imageMime(file.buffer);
    if (!mime || file.mimetype !== mime)
      throw new BadRequestException('Допустимы только изображения PNG, JPG и WebP');
    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user?.discordId) throw new BadRequestException('Для загрузки войдите через Discord');
    const id = randomUUID();
    await mkdir(this.directory, { recursive: true });
    const path = join(this.directory, id);
    await writeFile(path, file.buffer, { flag: 'wx' });
    try {
      await this.db.$transaction(async (tx) => {
        await tx.screenshot.create({ data: { id, userId, mime } });
        await tx.auditLog.create({
          data: {
            action: 'SCREENSHOT_UPLOAD',
            entityType: 'Screenshot',
            entityId: id,
            comment: 'Загружен приватный скриншот профиля',
          },
        });
      });
    } catch (error) {
      await unlink(path);
      throw error;
    }
    return { id };
  }
  async download(id: string, actor: SessionUser) {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new NotFoundException();
    const file = await this.db.screenshot.findUnique({ where: { id } });
    if (!file || (file.userId !== actor.userId && !can(actor, 'link_requests.review')))
      throw new NotFoundException('Скриншот недоступен');
    let data: Buffer;
    try {
      data = await readFile(join(this.directory, file.id));
    } catch {
      throw new NotFoundException('Скриншот не найден');
    }
    return new StreamableFile(data, {
      type: file.mime,
      disposition: 'inline',
      length: data.length,
    });
  }
}

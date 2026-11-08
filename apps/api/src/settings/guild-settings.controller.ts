import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  NotFoundException,
  Put,
  Req,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { guildNameSchema } from '@dkp/shared';
import sharp from 'sharp';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions/permissions.guard';
import { PrismaService } from '../prisma/prisma.service';

const MAX_BYTES = 2 * 1024 * 1024;
type CrestFile = { buffer: Buffer; size: number; mimetype: string };
@Controller('settings/guild')
@UseGuards(AuthGuard, PermissionsGuard)
export class GuildSettingsController {
  constructor(private readonly db: PrismaService) {}

  @Get('crest')
  @RequirePermission('members.view_roster')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  async crest() {
    const guild = await this.db.guild.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { crest: true, crestMime: true },
    });
    if (!guild?.crest || !guild.crestMime) throw new NotFoundException();
    return new StreamableFile(Buffer.from(guild.crest), { type: guild.crestMime });
  }

  @Put()
  @RequirePermission('settings.manage')
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_BYTES + 1, files: 1, fields: 1 } }),
  )
  async update(
    @Body('name') name: unknown,
    @UploadedFile() file: CrestFile | undefined,
    @Req() req: AuthedRequest,
  ) {
    const parsed = guildNameSchema.safeParse(name);
    if (!parsed.success) throw new BadRequestException('Название: от 1 до 80 символов');
    let crestMime: string | undefined;
    if (file) {
      if (!file.buffer?.length || file.size > MAX_BYTES)
        throw new BadRequestException('Герб должен быть до 2 МБ');
      try {
        const image = sharp(file.buffer, { limitInputPixels: 1024 * 1024, animated: false });
        const metadata = await image.metadata();
        if (
          !metadata.width ||
          !metadata.height ||
          metadata.width > 1024 ||
          metadata.height > 1024 ||
          (metadata.pages ?? 1) !== 1 ||
          !metadata.hasAlpha ||
          !['png', 'webp'].includes(metadata.format ?? '') ||
          file.mimetype !== `image/${metadata.format}`
        )
          throw new Error('format');
        const stats = await image.stats();
        if (stats.channels[stats.channels.length - 1]!.min === 255) throw new Error('opaque');
        crestMime = `image/${metadata.format}`;
      } catch {
        throw new BadRequestException('Нужен PNG или WebP с прозрачностью, до 2 МБ и 1024×1024');
      }
    }
    const actor = req.session!.user!;
    return this.db.$transaction(async (tx) => {
      const guild = await tx.guild.findFirst({ orderBy: { createdAt: 'asc' } });
      if (!guild) throw new NotFoundException('Гильдия не найдена');
      await tx.guild.update({
        where: { id: guild.id },
        data: {
          name: parsed.data,
          ...(file && crestMime ? { crest: Uint8Array.from(file.buffer), crestMime } : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorMemberId: actor.memberId,
          actorIsAdmin: actor.isAdmin,
          action: 'SETTINGS_UPDATE',
          entityType: 'Guild',
          entityId: guild.id,
          comment: `${actor.isAdmin ? 'Админ: ' : ''}Название: «${guild.name}» → «${parsed.data}»${file ? '; герб обновлён' : ''}`,
        },
      });
      return { name: parsed.data, hasCrest: !!file || !!guild.crest };
    });
  }
}

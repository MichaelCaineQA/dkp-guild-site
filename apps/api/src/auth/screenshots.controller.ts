import {
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { SCREENSHOT_MAX_BYTES } from '@dkp/shared';
import type { Response } from 'express';
import { AuthGuard, type AuthedRequest } from './auth.guard';
import { ScreenshotsService, type ScreenshotFile } from './screenshots.service';
@Controller('screenshots')
@UseGuards(AuthGuard)
export class ScreenshotsController {
  constructor(private readonly screenshots: ScreenshotsService) {}
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: SCREENSHOT_MAX_BYTES + 1, files: 1, fields: 0 },
    }),
  )
  upload(@Req() req: AuthedRequest, @UploadedFile() file?: ScreenshotFile) {
    return this.screenshots.upload(req.session!.user!.userId, file);
  }
  @Get(':id')
  async download(
    @Param('id') id: string,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.screenshots.download(id, req.session!.user!);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
    return file;
  }
}

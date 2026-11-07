import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseSettingValue, SETTING_DEFAULTS } from '@dkp/shared';
import { ConductController } from './conduct.controller';
import { ConductService, type ConductDb } from './conduct.service';

/** Проведение ивента (issue #10). */
@Module({
  controllers: [ConductController],
  providers: [
    PrismaService,
    {
      provide: ConductService,
      useFactory: (prisma: PrismaService) =>
        new ConductService(prisma as unknown as ConductDb, async (db) => {
          const rows = await db.setting.findMany({
            where: { key: { in: ['checkin.startSharePct', 'checkin.endSharePct'] } },
            select: { key: true, value: true },
          });
          const values = new Map(rows.map((row) => [row.key, row.value]));
          return {
            startSharePct: parseSettingValue(
              'checkin.startSharePct',
              values.get('checkin.startSharePct') ?? SETTING_DEFAULTS['checkin.startSharePct'],
            ),
            endSharePct: parseSettingValue(
              'checkin.endSharePct',
              values.get('checkin.endSharePct') ?? SETTING_DEFAULTS['checkin.endSharePct'],
            ),
          };
        }),
      inject: [PrismaService],
    },
  ],
})
export class ConductModule {}

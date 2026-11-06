import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RulesController } from './rules.controller';
import { RulesService, type RulesDb } from './rules.service';

@Module({
  controllers: [RulesController],
  providers: [
    {
      provide: RulesService,
      useFactory: (prisma: PrismaService) => new RulesService(prisma as unknown as RulesDb),
      inject: [PrismaService],
    },
  ],
})
export class RulesModule {}

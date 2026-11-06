import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilesController } from './profiles.controller';
import { ProfilesService, type ProfilesDb } from './profiles.service';

@Module({
  controllers: [ProfilesController],
  providers: [
    {
      provide: ProfilesService,
      useFactory: (prisma: PrismaService) => new ProfilesService(prisma as unknown as ProfilesDb),
      inject: [PrismaService],
    },
  ],
})
export class ProfilesModule {}

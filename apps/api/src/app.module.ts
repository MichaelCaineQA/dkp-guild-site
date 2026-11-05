import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { MembersModule } from './members/members.module';

@Module({
  imports: [PrismaModule, AuthModule, MembersModule],
  controllers: [AppController],
})
export class AppModule {}

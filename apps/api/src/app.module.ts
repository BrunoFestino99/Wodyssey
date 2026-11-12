import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccountEmailSender } from './email';
import { HealthController } from './health.controller';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 12 }])],
  controllers: [AuthController, HealthController],
  providers: [AuthService, AccountEmailSender, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}

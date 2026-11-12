import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccountEmailSender } from './email';
import { HealthController } from './health.controller';
import { database } from './database';

@Module({
  imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 30 }])],
  controllers: [AuthController, HealthController],
  providers: [AuthService, AccountEmailSender, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await database.end();
  }
}

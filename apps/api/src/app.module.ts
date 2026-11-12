import { Module, type OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccountEmailSender } from './email';
import { HealthController } from './health.controller';
import { database } from './database';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { SessionGuard } from './session.guard';

@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60_000, limit: 30 }],
      // Browser and API suites share one client address; main.ts rejects this in production.
      skipIf: () => process.env.TEST_RATE_LIMIT_DISABLED === 'true',
    }),
  ],
  controllers: [AuthController, HealthController, OrganizationsController],
  providers: [
    AuthService,
    AccountEmailSender,
    OrganizationsService,
    SessionGuard,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await database.end();
  }
}

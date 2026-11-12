import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';

@Controller('health')
@SkipThrottle()
export class HealthController {
  @Get()
  status(): { status: 'ok' } {
    return { status: 'ok' };
  }
}

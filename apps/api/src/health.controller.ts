import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  status(): { status: 'ok' } { return { status: 'ok' }; }
}

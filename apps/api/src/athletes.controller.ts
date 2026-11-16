import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';
import type { SignedInAccount } from './auth.service';
import { AthletesService, type Athlete } from './athletes.service';
import { CurrentAccount, SessionGuard } from './session.guard';

class ResponsibleCoaches {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  coaches!: string[];
}

@Controller('organizations/:organizationId/athletes')
@UseGuards(SessionGuard)
@Throttle({ default: { ttl: 60_000, limit: 120 } })
export class AthletesController {
  constructor(private readonly athletes: AthletesService) {}

  @Get()
  list(
    @CurrentAccount() account: SignedInAccount,
    @Param('organizationId') organizationId: string,
  ): Promise<Athlete[]> {
    return this.athletes.list(account.id, organizationId);
  }

  @Patch(':accountId')
  setCoaches(
    @CurrentAccount() account: SignedInAccount,
    @Param('organizationId') organizationId: string,
    @Param('accountId') accountId: string,
    @Body() body: ResponsibleCoaches,
  ): Promise<Athlete> {
    return this.athletes.setCoaches(account.id, organizationId, accountId, body.coaches);
  }
}

import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { SignedInAccount } from './auth.service';
import { OrganizationsService, type Organization } from './organizations.service';
import { CurrentAccount, SessionGuard } from './session.guard';

class OrganizationDetails {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;
}

@Controller('organizations')
@UseGuards(SessionGuard)
@Throttle({ default: { ttl: 60_000, limit: 120 } })
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  list(@CurrentAccount() account: SignedInAccount): Promise<Organization[]> {
    return this.organizations.list(account.id);
  }

  @Post()
  @HttpCode(201)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  create(
    @CurrentAccount() account: SignedInAccount,
    @Body() body: OrganizationDetails,
  ): Promise<Organization> {
    return this.organizations.create(account.id, body.name);
  }

  @Get(':id')
  get(@CurrentAccount() account: SignedInAccount, @Param('id') id: string): Promise<Organization> {
    return this.organizations.get(account.id, id);
  }

  @Patch(':id')
  rename(
    @CurrentAccount() account: SignedInAccount,
    @Param('id') id: string,
    @Body() body: OrganizationDetails,
  ): Promise<Organization> {
    return this.organizations.rename(account.id, id, body.name);
  }
}

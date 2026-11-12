import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn } from 'class-validator';
import type { SignedInAccount } from './auth.service';
import { MembersService, type Member } from './members.service';
import { MEMBER_ROLES, type MemberRole } from './organization-access';
import { CurrentAccount, SessionGuard } from './session.guard';

class MemberRoles {
  @IsArray()
  @ArrayMaxSize(MEMBER_ROLES.length)
  @ArrayUnique()
  @IsIn(MEMBER_ROLES, { each: true })
  roles!: MemberRole[];
}

@Controller('organizations/:organizationId/members')
@UseGuards(SessionGuard)
@Throttle({ default: { ttl: 60_000, limit: 120 } })
export class MembersController {
  constructor(private readonly members: MembersService) {}

  @Get()
  list(
    @CurrentAccount() account: SignedInAccount,
    @Param('organizationId') organizationId: string,
  ): Promise<Member[]> {
    return this.members.list(account.id, organizationId);
  }

  @Patch(':accountId')
  setRoles(
    @CurrentAccount() account: SignedInAccount,
    @Param('organizationId') organizationId: string,
    @Param('accountId') accountId: string,
    @Body() body: MemberRoles,
  ): Promise<Member> {
    return this.members.setMemberRoles(account.id, organizationId, accountId, body.roles);
  }
}

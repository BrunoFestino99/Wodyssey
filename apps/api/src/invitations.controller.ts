import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { Request } from 'express';
import { AuthService, type SignedInAccount } from './auth.service';
import {
  InvitationsService,
  type Invitation,
  type InvitationPreview,
  type SentInvitation,
} from './invitations.service';
import { MEMBER_ROLES, type MemberRole } from './organization-access';
import type { Organization } from './organizations.service';
import { CurrentAccount, SessionGuard } from './session.guard';

class InvitationRequest {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MEMBER_ROLES.length)
  @ArrayUnique()
  @IsIn(MEMBER_ROLES, { each: true })
  roles!: MemberRole[];
}

class InvitationToken {
  @IsString() @MinLength(32) @MaxLength(256) token!: string;
}

/** Invitations an organization's administrators and coaches send and follow up on. */
@Controller('organizations/:organizationId/invitations')
@UseGuards(SessionGuard)
@Throttle({ default: { ttl: 60_000, limit: 120 } })
export class OrganizationInvitationsController {
  constructor(private readonly invitations: InvitationsService) {}

  @Get()
  listPending(
    @CurrentAccount() account: SignedInAccount,
    @Param('organizationId') organizationId: string,
  ): Promise<Invitation[]> {
    return this.invitations.listPending(account.id, organizationId);
  }

  @Post()
  @HttpCode(201)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  invite(
    @CurrentAccount() account: SignedInAccount,
    @Param('organizationId') organizationId: string,
    @Body() body: InvitationRequest,
  ): Promise<SentInvitation> {
    return this.invitations.create(account.id, organizationId, body.email, body.roles);
  }

  @Delete(':invitationId')
  @HttpCode(204)
  revoke(
    @CurrentAccount() account: SignedInAccount,
    @Param('organizationId') organizationId: string,
    @Param('invitationId') invitationId: string,
  ): Promise<void> {
    return this.invitations.revoke(account.id, organizationId, invitationId);
  }
}

/** The invited person's side: reviewing an invitation link and accepting it. */
@Controller('invitations')
export class InvitationsController {
  constructor(
    private readonly invitations: InvitationsService,
    private readonly auth: AuthService,
  ) {}

  /** Works signed out; a signed-in account that already accepted learns where it joined. */
  @Post('preview')
  @HttpCode(200)
  async preview(
    @Req() request: Request,
    @Body() body: InvitationToken,
  ): Promise<InvitationPreview> {
    const account = await this.auth.currentAccount(request.cookies?.wodyssey_session);
    return this.invitations.preview(body.token, account);
  }

  @Post('accept')
  @HttpCode(200)
  @UseGuards(SessionGuard)
  accept(
    @CurrentAccount() account: SignedInAccount,
    @Body() body: InvitationToken,
  ): Promise<Organization> {
    return this.invitations.accept(account, body.token);
  }
}

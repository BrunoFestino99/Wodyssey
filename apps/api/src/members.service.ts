import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, inArray, notInArray } from 'drizzle-orm';
import { db } from './database';
import {
  aggregatedRoles,
  assertIdentifier,
  lockMemberships,
  membershipRolesJoin,
  sortedRoles,
} from './organization-access';
import { OrganizationsService } from './organizations.service';
import { MEMBER_ROLES, type MemberRole, type OrganizationRole } from './roles';
import { accounts, organizationMembershipRoles, organizationMemberships } from './schema';

export type Member = { accountId: string; email: string; roles: OrganizationRole[] };

@Injectable()
export class MembersService {
  constructor(private readonly organizations: OrganizationsService) {}

  async list(actorId: string, organizationId: string): Promise<Member[]> {
    const { roles } = await this.organizations.get(actorId, organizationId);
    if (!roles.includes('administrator')) throw new ForbiddenException();
    return db
      .select({
        accountId: organizationMemberships.accountId,
        email: accounts.email,
        roles: aggregatedRoles,
      })
      .from(organizationMemberships)
      .innerJoin(accounts, eq(accounts.id, organizationMemberships.accountId))
      .leftJoin(organizationMembershipRoles, membershipRolesJoin)
      .where(eq(organizationMemberships.organizationId, organizationId))
      .groupBy(organizationMemberships.accountId, accounts.email, organizationMemberships.joinedAt)
      .orderBy(organizationMemberships.joinedAt, accounts.email);
  }

  /**
   * Sets which of the coach and athlete roles a member holds. The administrator role is
   * kept as it is, and every member keeps at least one role.
   */
  async setMemberRoles(
    actorId: string,
    organizationId: string,
    accountId: string,
    memberRoles: MemberRole[],
  ): Promise<Member> {
    assertIdentifier(accountId);
    return db.transaction(async (tx) => {
      const locked = await lockMemberships(tx, organizationId, [actorId, accountId], 'update');
      const actor = locked.get(actorId);
      if (!actor) throw new NotFoundException();
      if (!actor.includes('administrator')) throw new ForbiddenException();
      const current = locked.get(accountId);
      if (!current) throw new NotFoundException();
      const roles = sortedRoles<OrganizationRole>([
        ...current.filter((role) => role === 'administrator'),
        ...memberRoles,
      ]);
      if (roles.length === 0) throw new BadRequestException('A member needs at least one role.');
      await tx
        .delete(organizationMembershipRoles)
        .where(
          and(
            eq(organizationMembershipRoles.organizationId, organizationId),
            eq(organizationMembershipRoles.accountId, accountId),
            inArray(organizationMembershipRoles.role, MEMBER_ROLES),
            notInArray(organizationMembershipRoles.role, memberRoles),
          ),
        );
      if (memberRoles.length > 0)
        await tx
          .insert(organizationMembershipRoles)
          .values(memberRoles.map((role) => ({ organizationId, accountId, role })))
          .onConflictDoNothing();
      const [member] = await tx
        .select({ email: accounts.email })
        .from(accounts)
        .where(eq(accounts.id, accountId));
      return { accountId, email: member.email, roles };
    });
  }
}

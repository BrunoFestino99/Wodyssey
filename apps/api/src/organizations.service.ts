import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, exists, sql, type SQL } from 'drizzle-orm';
import { db } from './database';
import { aggregatedRoles, assertIdentifier, membershipRolesJoin } from './organization-access';
import type { OrganizationRole } from './roles';
import { organizationMembershipRoles, organizationMemberships, organizations } from './schema';

export type Organization = { id: string; name: string; roles: OrganizationRole[] };

// Only organizations the account belongs to are ever selected.
function memberOrganizations(accountId: string, where?: SQL) {
  return db
    .select({ id: organizations.id, name: organizations.name, roles: aggregatedRoles })
    .from(organizations)
    .innerJoin(
      organizationMemberships,
      and(
        eq(organizationMemberships.organizationId, organizations.id),
        eq(organizationMemberships.accountId, accountId),
      ),
    )
    .leftJoin(organizationMembershipRoles, membershipRolesJoin)
    .where(where)
    .groupBy(organizations.id);
}

@Injectable()
export class OrganizationsService {
  async create(accountId: string, name: string): Promise<Organization> {
    return db.transaction(async (tx) => {
      const [organization] = await tx
        .insert(organizations)
        .values({ name, createdBy: accountId })
        .returning({ id: organizations.id, name: organizations.name });
      await tx
        .insert(organizationMemberships)
        .values({ organizationId: organization.id, accountId });
      await tx
        .insert(organizationMembershipRoles)
        .values({ organizationId: organization.id, accountId, role: 'administrator' });
      return { ...organization, roles: ['administrator'] };
    });
  }

  async list(accountId: string): Promise<Organization[]> {
    return memberOrganizations(accountId).orderBy(organizations.createdAt, organizations.id);
  }

  /** Non-members get the same answer as for an organization that does not exist. */
  async get(accountId: string, organizationId: string): Promise<Organization> {
    assertIdentifier(organizationId);
    const [organization] = await memberOrganizations(
      accountId,
      eq(organizations.id, organizationId),
    );
    if (!organization) throw new NotFoundException();
    return organization;
  }

  async rename(accountId: string, organizationId: string, name: string): Promise<Organization> {
    const organization = await this.get(accountId, organizationId);
    if (!organization.roles.includes('administrator')) throw new ForbiddenException();
    // The role is checked again in the write so a concurrent revocation cannot be bypassed.
    const [renamed] = await db
      .update(organizations)
      .set({ name })
      .where(
        and(
          eq(organizations.id, organizationId),
          exists(
            db
              .select({ one: sql`1` })
              .from(organizationMembershipRoles)
              .where(
                and(
                  eq(organizationMembershipRoles.organizationId, organizationId),
                  eq(organizationMembershipRoles.accountId, accountId),
                  eq(organizationMembershipRoles.role, 'administrator'),
                ),
              ),
          ),
        ),
      )
      .returning({ name: organizations.name });
    if (!renamed) throw new ForbiddenException();
    return { ...organization, name: renamed.name };
  }
}

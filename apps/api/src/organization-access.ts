import { NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Transaction } from './database';
import type { MemberRole, OrganizationRole } from './roles';
import { organizationMembershipRoles, organizationMemberships } from './schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Malformed identifiers answer like any other organization the account cannot see. */
export function assertIdentifier(id: string): void {
  if (!UUID.test(id)) throw new NotFoundException();
}

/** Orders roles the same way the database aggregates them. */
export function sortedRoles<Role extends OrganizationRole>(roles: Iterable<Role>): Role[] {
  return [...new Set(roles)].sort();
}

/** Joins a membership to its roles, keeping memberships without any. */
export const membershipRolesJoin = and(
  eq(organizationMembershipRoles.organizationId, organizationMemberships.organizationId),
  eq(organizationMembershipRoles.accountId, organizationMemberships.accountId),
);

/** The roles joined through `membershipRolesJoin`, ordered, or an empty array when there are none. */
export const aggregatedRoles = sql<
  OrganizationRole[]
>`coalesce(array_agg(${organizationMembershipRoles.role} ORDER BY ${organizationMembershipRoles.role})
  FILTER (WHERE ${organizationMembershipRoles.role} IS NOT NULL), '{}')`;

/**
 * Roles of every listed member, locking their memberships until the transaction ends
 * so concurrent role changes cannot interleave with checks made on them. Rows are
 * locked in a fixed order to avoid deadlocks; non-members are absent from the result.
 */
export async function lockMemberships(
  tx: Transaction,
  organizationId: string,
  accountIds: string[],
  mode: 'share' | 'update',
): Promise<Map<string, OrganizationRole[]>> {
  assertIdentifier(organizationId);
  const locked = await tx
    .select({ accountId: organizationMemberships.accountId })
    .from(organizationMemberships)
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        inArray(organizationMemberships.accountId, accountIds),
      ),
    )
    .orderBy(organizationMemberships.accountId)
    .for(mode);
  const roles = new Map(locked.map((row) => [row.accountId, [] as OrganizationRole[]]));
  const granted = await tx
    .select({
      accountId: organizationMembershipRoles.accountId,
      role: organizationMembershipRoles.role,
    })
    .from(organizationMembershipRoles)
    .where(
      and(
        eq(organizationMembershipRoles.organizationId, organizationId),
        inArray(organizationMembershipRoles.accountId, accountIds),
      ),
    )
    .orderBy(organizationMembershipRoles.role);
  for (const { accountId, role } of granted) roles.get(accountId)?.push(role);
  return roles;
}

/** The acting account's roles, locked for the transaction; non-members are not found. */
export async function actorRoles(
  tx: Transaction,
  organizationId: string,
  accountId: string,
): Promise<OrganizationRole[]> {
  const roles = (await lockMemberships(tx, organizationId, [accountId], 'share')).get(accountId);
  if (!roles) throw new NotFoundException();
  return roles;
}

/** Administrators invite coaches and athletes; coaches invite athletes. */
export function mayInvite(actor: OrganizationRole[], roles: MemberRole[]): boolean {
  if (actor.includes('administrator')) return true;
  return actor.includes('coach') && roles.every((role) => role === 'athlete');
}

/** Whoever may send invitations may also review and revoke them. */
export function mayFollowUpInvitations(actor: OrganizationRole[]): boolean {
  return actor.includes('administrator') || actor.includes('coach');
}

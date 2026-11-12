import { NotFoundException } from '@nestjs/common';
import type { PoolClient } from 'pg';

export type OrganizationRole = 'administrator' | 'athlete' | 'coach';
/** Roles granted through invitations and member management; administrators are not invited. */
export type MemberRole = Exclude<OrganizationRole, 'administrator'>;
export const MEMBER_ROLES: readonly MemberRole[] = ['athlete', 'coach'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Malformed identifiers answer like any other organization the account cannot see. */
export function assertIdentifier(id: string): void {
  if (!UUID.test(id)) throw new NotFoundException();
}

/** Orders roles the same way the database aggregates them. */
export function sortedRoles<Role extends OrganizationRole>(roles: Iterable<Role>): Role[] {
  return [...new Set(roles)].sort();
}

/**
 * Roles of every listed member, locking their memberships until the transaction ends
 * so concurrent role changes cannot interleave with checks made on them. Rows are
 * locked in a fixed order to avoid deadlocks; non-members are absent from the result.
 */
export async function lockMemberships(
  client: PoolClient,
  organizationId: string,
  accountIds: string[],
  mode: 'SHARE' | 'UPDATE',
): Promise<Map<string, OrganizationRole[]>> {
  assertIdentifier(organizationId);
  const locked = await client.query<{ account_id: string }>(
    `SELECT account_id FROM organization_memberships
     WHERE organization_id = $1 AND account_id = ANY($2::uuid[])
     ORDER BY account_id FOR ${mode}`,
    [organizationId, accountIds],
  );
  const roles = new Map(locked.rows.map((row) => [row.account_id, [] as OrganizationRole[]]));
  const granted = await client.query<{ account_id: string; role: OrganizationRole }>(
    `SELECT account_id, role FROM organization_membership_roles
     WHERE organization_id = $1 AND account_id = ANY($2::uuid[]) ORDER BY role`,
    [organizationId, accountIds],
  );
  for (const { account_id, role } of granted.rows) roles.get(account_id)?.push(role);
  return roles;
}

/** The acting account's roles, locked for the transaction; non-members are not found. */
export async function actorRoles(
  client: PoolClient,
  organizationId: string,
  accountId: string,
): Promise<OrganizationRole[]> {
  const roles = (await lockMemberships(client, organizationId, [accountId], 'SHARE')).get(
    accountId,
  );
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

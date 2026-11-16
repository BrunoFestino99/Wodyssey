import { and, eq } from 'drizzle-orm';
import type { Transaction } from './database';
import type { MemberRole } from './roles';
import { athleteCoaches, organizationMembershipRoles } from './schema';

async function holdersOf(tx: Transaction, organizationId: string, role: MemberRole) {
  const holders = await tx
    .select({ accountId: organizationMembershipRoles.accountId })
    .from(organizationMembershipRoles)
    .where(
      and(
        eq(organizationMembershipRoles.organizationId, organizationId),
        eq(organizationMembershipRoles.role, role),
      ),
    );
  return holders.map((holder) => holder.accountId);
}

/**
 * While an organization has a single coach, that coach is responsible for every athlete,
 * themselves included when they also train. Call after any change to who holds the coach or
 * athlete role, with the organization locked (see `lockOrganization`).
 */
export async function assignSoleCoach(tx: Transaction, organizationId: string): Promise<void> {
  const coaches = await holdersOf(tx, organizationId, 'coach');
  if (coaches.length !== 1) return;
  const athletes = await holdersOf(tx, organizationId, 'athlete');
  if (athletes.length === 0) return;
  await tx
    .insert(athleteCoaches)
    .values(athletes.map((athleteId) => ({ organizationId, athleteId, coachId: coaches[0] })))
    .onConflictDoNothing();
}

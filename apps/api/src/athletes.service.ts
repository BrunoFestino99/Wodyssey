import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, exists, inArray, notInArray, sql } from 'drizzle-orm';
import { db, type Transaction } from './database';
import {
  actorRoles,
  assertIdentifier,
  lockMemberships,
  lockOrganization,
} from './organization-access';
import type { OrganizationRole } from './roles';
import {
  accounts,
  athleteCoaches,
  organizationMembershipRoles,
  organizationMemberships,
} from './schema';

export type ResponsibleCoach = { accountId: string; email: string };
export type Athlete = { accountId: string; email: string; coaches: ResponsibleCoach[] };

const athleteRole = and(
  eq(organizationMembershipRoles.organizationId, organizationMemberships.organizationId),
  eq(organizationMembershipRoles.accountId, organizationMemberships.accountId),
  eq(organizationMembershipRoles.role, 'athlete'),
);

/** Athletes of the organization, optionally only those a coach is responsible for. */
async function athletes(
  tx: Transaction,
  organizationId: string,
  filter: { athleteId?: string; coachId?: string },
): Promise<Athlete[]> {
  const found = await tx
    .select({ accountId: organizationMemberships.accountId, email: accounts.email })
    .from(organizationMemberships)
    .innerJoin(organizationMembershipRoles, athleteRole)
    .innerJoin(accounts, eq(accounts.id, organizationMemberships.accountId))
    .where(
      and(
        eq(organizationMemberships.organizationId, organizationId),
        filter.athleteId ? eq(organizationMemberships.accountId, filter.athleteId) : undefined,
        filter.coachId
          ? exists(
              tx
                .select({ one: sql`1` })
                .from(athleteCoaches)
                .where(
                  and(
                    eq(athleteCoaches.organizationId, organizationId),
                    eq(athleteCoaches.athleteId, organizationMemberships.accountId),
                    eq(athleteCoaches.coachId, filter.coachId),
                  ),
                ),
            )
          : undefined,
      ),
    )
    .orderBy(organizationMemberships.joinedAt, accounts.email);
  if (found.length === 0) return [];
  const assigned = await tx
    .select({
      athleteId: athleteCoaches.athleteId,
      accountId: athleteCoaches.coachId,
      email: accounts.email,
    })
    .from(athleteCoaches)
    .innerJoin(accounts, eq(accounts.id, athleteCoaches.coachId))
    .where(
      and(
        eq(athleteCoaches.organizationId, organizationId),
        inArray(
          athleteCoaches.athleteId,
          found.map((athlete) => athlete.accountId),
        ),
      ),
    )
    .orderBy(accounts.email);
  return found.map((athlete) => ({
    ...athlete,
    coaches: assigned
      .filter((coach) => coach.athleteId === athlete.accountId)
      .map(({ accountId, email }) => ({ accountId, email })),
  }));
}

@Injectable()
export class AthletesService {
  /** Administrators see every athlete; coaches see the athletes they are responsible for. */
  async list(actorId: string, organizationId: string): Promise<Athlete[]> {
    return db.transaction(async (tx) => {
      const roles = await actorRoles(tx, organizationId, actorId);
      if (roles.includes('administrator')) return athletes(tx, organizationId, {});
      if (roles.includes('coach')) return athletes(tx, organizationId, { coachId: actorId });
      throw new ForbiddenException();
    });
  }

  /** Replaces the coaches responsible for an athlete; only administrators decide this. */
  async setCoaches(
    actorId: string,
    organizationId: string,
    athleteId: string,
    coachIds: string[],
  ): Promise<Athlete> {
    assertIdentifier(organizationId);
    assertIdentifier(athleteId);
    return db.transaction(async (tx) => {
      await lockOrganization(tx, organizationId);
      const locked = await lockMemberships(
        tx,
        organizationId,
        [...new Set([actorId, athleteId, ...coachIds])],
        'share',
      );
      const actor = locked.get(actorId);
      if (!actor) throw new NotFoundException();
      if (!actor.includes('administrator')) throw new ForbiddenException();
      const holds = (accountId: string, role: OrganizationRole) =>
        locked.get(accountId)?.includes(role) ?? false;
      if (!holds(athleteId, 'athlete')) throw new NotFoundException();
      if (!coachIds.every((coachId) => holds(coachId, 'coach')))
        throw new BadRequestException('Choose coaches of this organization.');
      await tx
        .delete(athleteCoaches)
        .where(
          and(
            eq(athleteCoaches.organizationId, organizationId),
            eq(athleteCoaches.athleteId, athleteId),
            notInArray(athleteCoaches.coachId, coachIds),
          ),
        );
      await tx
        .insert(athleteCoaches)
        .values(coachIds.map((coachId) => ({ organizationId, athleteId, coachId })))
        .onConflictDoNothing();
      const [athlete] = await athletes(tx, organizationId, { athleteId });
      return athlete;
    });
  }
}

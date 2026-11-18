import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, exists, notInArray, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
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

const coachAccounts = alias(accounts, 'coach_accounts');
const responsibility = alias(athleteCoaches, 'responsibility');

/** The responsible coaches joined to an athlete, ordered, or an empty array when there are none. */
const responsibleCoaches = sql<ResponsibleCoach[]>`coalesce(
  json_agg(json_build_object('accountId', ${coachAccounts.id}, 'email', ${coachAccounts.email})
    ORDER BY ${coachAccounts.email}) FILTER (WHERE ${coachAccounts.id} IS NOT NULL),
  '[]')`;

/** Keeps the athletes a coach is responsible for. */
const responsibleFor = (coachId: string) =>
  exists(
    db
      .select({ one: sql`1` })
      .from(responsibility)
      .where(
        and(
          eq(responsibility.organizationId, organizationMemberships.organizationId),
          eq(responsibility.athleteId, organizationMemberships.accountId),
          eq(responsibility.coachId, coachId),
        ),
      ),
  );

/**
 * Athletes of the organization that match `condition`, with their responsible coaches. One
 * statement reads both, so the coaches always belong to the athletes returned with them.
 */
async function athletesWhere(
  tx: Transaction,
  organizationId: string,
  condition?: SQL,
): Promise<Athlete[]> {
  return tx
    .select({
      accountId: organizationMemberships.accountId,
      email: accounts.email,
      coaches: responsibleCoaches,
    })
    .from(organizationMemberships)
    .innerJoin(organizationMembershipRoles, athleteRole)
    .innerJoin(accounts, eq(accounts.id, organizationMemberships.accountId))
    .leftJoin(
      athleteCoaches,
      and(
        eq(athleteCoaches.organizationId, organizationMemberships.organizationId),
        eq(athleteCoaches.athleteId, organizationMemberships.accountId),
      ),
    )
    .leftJoin(coachAccounts, eq(coachAccounts.id, athleteCoaches.coachId))
    .where(and(eq(organizationMemberships.organizationId, organizationId), condition))
    .groupBy(organizationMemberships.organizationId, organizationMemberships.accountId, accounts.id)
    .orderBy(organizationMemberships.joinedAt, accounts.email);
}

@Injectable()
export class AthletesService {
  /** Administrators see every athlete; coaches see the athletes they are responsible for. */
  async list(actorId: string, organizationId: string): Promise<Athlete[]> {
    return db.transaction(async (tx) => {
      const roles = await actorRoles(tx, organizationId, actorId);
      if (roles.includes('administrator')) return athletesWhere(tx, organizationId);
      if (roles.includes('coach'))
        return athletesWhere(tx, organizationId, responsibleFor(actorId));
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
      const [athlete] = await athletesWhere(
        tx,
        organizationId,
        eq(organizationMemberships.accountId, athleteId),
      );
      return athlete;
    });
  }
}

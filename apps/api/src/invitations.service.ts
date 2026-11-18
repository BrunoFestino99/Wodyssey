import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, arrayContained, eq, exists, gt, isNull, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { normalizedEmail, type SignedInAccount } from './auth.service';
import { db, lower, now } from './database';
import { AccountEmailSender, emailLink } from './email';
import { hashToken, newToken } from './one-time-tokens';
import {
  actorRoles,
  assertIdentifier,
  lockMemberships,
  lockOrganization,
  mayFollowUpInvitations,
  mayInvite,
  sortedRoles,
} from './organization-access';
import { OrganizationsService, type Organization } from './organizations.service';
import type { MemberRole, OrganizationRole } from './roles';
import {
  accounts,
  organizationInvitations as invitations,
  organizationMembershipRoles,
  organizationMemberships,
  organizations,
} from './schema';
import { assignSoleCoach } from './sole-coach';

const DEFAULT_INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000;

function invitationLifetimeMs(): number {
  if (process.env.EMAIL_TRANSPORT === 'memory' && process.env.TEST_MAILBOX_ENABLED === 'true') {
    const testLifetime = Number(process.env.TEST_INVITATION_LIFETIME_MS);
    if (Number.isSafeInteger(testLifetime) && testLifetime >= 100 && testLifetime <= 60_000)
      return testLifetime;
  }
  return DEFAULT_INVITATION_LIFETIME_MS;
}

export type Invitation = {
  id: string;
  email: string;
  roles: MemberRole[];
  invitedBy: string;
  expiresAt: Date;
};
export type SentInvitation = { invitation: Invitation; url: string };
export type InvitationPreview =
  | {
      status: 'pending';
      organization: { name: string };
      email: string;
      roles: MemberRole[];
      expiresAt: Date;
    }
  | { status: 'joined'; organization: { id: string; name: string } };

const inviterRole = alias(organizationMembershipRoles, 'inviter_role');
const inviter = alias(accounts, 'inviter');

/**
 * An invitation can be accepted while it is unused, unrevoked, unexpired, and its inviter
 * still holds a role allowed to send it (the same rule as `mayInvite`): removing someone's
 * coach role also withdraws the athlete invitations they sent.
 */
const PENDING: SQL<boolean> = sql`${and(
  isNull(invitations.acceptedAt),
  isNull(invitations.revokedAt),
  gt(invitations.expiresAt, now()),
  exists(
    db
      .select({ one: sql`1` })
      .from(inviterRole)
      .where(
        and(
          eq(inviterRole.organizationId, invitations.organizationId),
          eq(inviterRole.accountId, invitations.invitedBy),
          or(
            eq(inviterRole.role, 'administrator'),
            and(eq(inviterRole.role, 'coach'), eq(invitations.roles, ['athlete'])),
          ),
        ),
      ),
  ),
)}`;

/** Administrators follow up every invitation; coaches only the ones they sent. */
const followedUpBy = (actorId: string, roles: OrganizationRole[]) =>
  roles.includes('administrator') ? undefined : eq(invitations.invitedBy, actorId);

const INVITATION_FIELDS = {
  id: invitations.id,
  email: invitations.email,
  roles: invitations.roles,
  invitedBy: inviter.email,
  expiresAt: invitations.expiresAt,
};

@Injectable()
export class InvitationsService {
  constructor(
    private readonly email: AccountEmailSender,
    private readonly organizations: OrganizationsService,
  ) {}

  /**
   * Emails a one-time link. Resending replaces the sender's pending invitation to the same
   * address with the same roles, leaving a single usable link; other people's stay valid.
   */
  async create(
    actorId: string,
    organizationId: string,
    emailInput: string,
    requestedRoles: MemberRole[],
  ): Promise<SentInvitation> {
    const email = normalizedEmail(emailInput);
    const roles = sortedRoles(requestedRoles);
    const token = newToken();
    const invitation = await db.transaction(async (tx) => {
      if (!mayInvite(await actorRoles(tx, organizationId, actorId), roles))
        throw new ForbiddenException();
      const held = await tx
        .select({ role: organizationMembershipRoles.role })
        .from(organizationMembershipRoles)
        .innerJoin(accounts, eq(accounts.id, organizationMembershipRoles.accountId))
        .where(
          and(
            eq(organizationMembershipRoles.organizationId, organizationId),
            eq(lower(accounts.email), email),
          ),
        );
      const heldRoles = new Set(held.map((row) => row.role));
      if (roles.every((role) => heldRoles.has(role)))
        throw new ConflictException('This person already has these roles.');
      await tx
        .update(invitations)
        .set({ revokedAt: now() })
        .where(
          and(
            eq(invitations.organizationId, organizationId),
            eq(invitations.email, email),
            eq(invitations.roles, roles),
            eq(invitations.invitedBy, actorId),
            PENDING,
          ),
        );
      const [inserted] = await tx
        .insert(invitations)
        .values({
          organizationId,
          email,
          roles,
          tokenHash: hashToken(token),
          invitedBy: actorId,
          expiresAt: new Date(Date.now() + invitationLifetimeMs()),
        })
        .returning({ id: invitations.id });
      const [created] = await tx
        .select(INVITATION_FIELDS)
        .from(invitations)
        .innerJoin(inviter, eq(inviter.id, invitations.invitedBy))
        .where(eq(invitations.id, inserted.id));
      const [organization] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, organizationId));
      // Sending before commit means a failed email leaves no invitation nobody received.
      await this.email.sendInvitation(email, token, organization.name);
      return created;
    });
    return { invitation, url: emailLink('invitation', token) };
  }

  /** Administrators see every pending invitation; coaches see the ones they sent. */
  async listPending(actorId: string, organizationId: string): Promise<Invitation[]> {
    return db.transaction(async (tx) => {
      const roles = await actorRoles(tx, organizationId, actorId);
      if (!mayFollowUpInvitations(roles)) throw new ForbiddenException();
      return tx
        .select(INVITATION_FIELDS)
        .from(invitations)
        .innerJoin(inviter, eq(inviter.id, invitations.invitedBy))
        .where(
          and(
            eq(invitations.organizationId, organizationId),
            PENDING,
            followedUpBy(actorId, roles),
          ),
        )
        .orderBy(invitations.createdAt, invitations.id);
    });
  }

  async revoke(actorId: string, organizationId: string, invitationId: string): Promise<void> {
    await db.transaction(async (tx) => {
      const roles = await actorRoles(tx, organizationId, actorId);
      assertIdentifier(invitationId);
      if (!mayFollowUpInvitations(roles)) throw new ForbiddenException();
      const revoked = await tx
        .update(invitations)
        .set({ revokedAt: now() })
        .where(
          and(
            eq(invitations.id, invitationId),
            eq(invitations.organizationId, organizationId),
            PENDING,
            followedUpBy(actorId, roles),
          ),
        )
        .returning({ id: invitations.id });
      if (revoked.length === 0) throw new NotFoundException();
    });
  }

  /**
   * What a pending invitation offers, shown before signing in to accept it. The account
   * that already accepted it learns which organization it joined; to anyone else a used
   * invitation does not exist.
   */
  async preview(token: string, account: SignedInAccount | null): Promise<InvitationPreview> {
    const [invitation] = await db
      .select({
        organizationId: invitations.organizationId,
        name: organizations.name,
        email: invitations.email,
        roles: invitations.roles,
        expiresAt: invitations.expiresAt,
        acceptedBy: invitations.acceptedBy,
        pending: PENDING,
      })
      .from(invitations)
      .innerJoin(organizations, eq(organizations.id, invitations.organizationId))
      .where(eq(invitations.tokenHash, hashToken(token)));
    if (account && invitation?.acceptedBy === account.id) {
      const joined = await this.organizations
        .get(account.id, invitation.organizationId)
        .catch(() => null);
      if (joined) return { status: 'joined', organization: { id: joined.id, name: joined.name } };
    }
    if (!invitation?.pending) throw new NotFoundException();
    return {
      status: 'pending',
      organization: { name: invitation.name },
      email: invitation.email,
      roles: invitation.roles,
      expiresAt: invitation.expiresAt,
    };
  }

  /**
   * Grants the invitation's roles to the account it was addressed to, once. Accepting
   * again from the same account answers with the organization instead of failing.
   */
  async accept(account: SignedInAccount, token: string): Promise<Organization> {
    const tokenHash = hashToken(token);
    const organizationId = await db.transaction(async (tx) => {
      const [found] = await tx
        .select({
          organizationId: invitations.organizationId,
          invitedBy: invitations.invitedBy,
        })
        .from(invitations)
        .where(eq(invitations.tokenHash, tokenHash));
      if (!found) throw new NotFoundException();
      await lockOrganization(tx, found.organizationId);
      // Holding the inviter's membership keeps their roles stable while they authorize this.
      await lockMemberships(tx, found.organizationId, [found.invitedBy], 'share');
      const [invitation] = await tx
        .select({
          id: invitations.id,
          organizationId: invitations.organizationId,
          email: invitations.email,
          roles: invitations.roles,
          acceptedBy: invitations.acceptedBy,
          pending: PENDING,
        })
        .from(invitations)
        .where(eq(invitations.tokenHash, tokenHash))
        .for('update', { of: invitations });
      if (invitation?.acceptedBy === account.id) return invitation.organizationId;
      if (!invitation?.pending) throw new NotFoundException();
      if (invitation.email !== normalizedEmail(account.email))
        throw new ForbiddenException('This invitation was sent to a different email address.');
      await tx
        .insert(organizationMemberships)
        .values({ organizationId: invitation.organizationId, accountId: account.id })
        .onConflictDoNothing();
      await tx
        .insert(organizationMembershipRoles)
        .values(
          invitation.roles.map((role) => ({
            organizationId: invitation.organizationId,
            accountId: account.id,
            role,
          })),
        )
        .onConflictDoNothing();
      await tx
        .update(invitations)
        .set({ acceptedAt: now(), acceptedBy: account.id })
        .where(eq(invitations.id, invitation.id));
      await assignSoleCoach(tx, invitation.organizationId);
      // Other pending invitations that offer nothing new would only linger in the list.
      const heldRoles = tx
        .select({ role: organizationMembershipRoles.role })
        .from(organizationMembershipRoles)
        .where(
          and(
            eq(organizationMembershipRoles.organizationId, invitation.organizationId),
            eq(organizationMembershipRoles.accountId, account.id),
          ),
        );
      await tx
        .update(invitations)
        .set({ revokedAt: now() })
        .where(
          and(
            eq(invitations.organizationId, invitation.organizationId),
            eq(invitations.email, invitation.email),
            PENDING,
            arrayContained(invitations.roles, sql`ARRAY(${heldRoles})`),
          ),
        );
      return invitation.organizationId;
    });
    return this.organizations.get(account.id, organizationId);
  }
}

import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { normalizedEmail, type SignedInAccount } from './auth.service';
import { query, withTransaction } from './database';
import { AccountEmailSender, emailLink } from './email';
import { hashToken, newToken } from './one-time-tokens';
import {
  actorRoles,
  assertIdentifier,
  lockMemberships,
  mayFollowUpInvitations,
  mayInvite,
  sortedRoles,
  type MemberRole,
  type OrganizationRole,
} from './organization-access';
import { OrganizationsService, type Organization } from './organizations.service';

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
  expiresAt: string;
};
export type SentInvitation = { invitation: Invitation; url: string };
export type InvitationPreview =
  | {
      status: 'pending';
      organization: { name: string };
      email: string;
      roles: MemberRole[];
      expiresAt: string;
    }
  | { status: 'joined'; organization: { id: string; name: string } };

/**
 * An invitation can be accepted while it is unused, unrevoked, unexpired, and its inviter
 * still holds a role allowed to send it (the same rule as `mayInvite`): removing someone's
 * coach role also withdraws the athlete invitations they sent.
 */
const PENDING = `i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
  AND EXISTS (
    SELECT 1 FROM organization_membership_roles inviter_role
    WHERE inviter_role.organization_id = i.organization_id
      AND inviter_role.account_id = i.invited_by
      AND (inviter_role.role = 'administrator'
        OR (inviter_role.role = 'coach' AND i.roles = ARRAY['athlete']::text[])))`;
const INVITATION_FIELDS = `i.id, i.email, i.roles, inviter.email AS "invitedBy", i.expires_at AS "expiresAt"`;

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
    const invitation = await withTransaction(async (client) => {
      if (!mayInvite(await actorRoles(client, organizationId, actorId), roles))
        throw new ForbiddenException();
      const held = await client.query<{ role: OrganizationRole }>(
        `SELECT r.role FROM organization_membership_roles r
         JOIN accounts a ON a.id = r.account_id
         WHERE r.organization_id = $1 AND lower(a.email) = $2`,
        [organizationId, email],
      );
      const heldRoles = new Set(held.rows.map((row) => row.role));
      if (roles.every((role) => heldRoles.has(role)))
        throw new ConflictException('This person already has these roles.');
      await client.query(
        `UPDATE organization_invitations i SET revoked_at = now()
         WHERE i.organization_id = $1 AND i.email = $2 AND i.roles = $3::text[]
           AND i.invited_by = $4 AND ${PENDING}`,
        [organizationId, email, roles, actorId],
      );
      const inserted = await client.query<Invitation>(
        `WITH i AS (
           INSERT INTO organization_invitations
             (organization_id, email, roles, token_hash, invited_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING *)
         SELECT ${INVITATION_FIELDS} FROM i JOIN accounts inviter ON inviter.id = i.invited_by`,
        [
          organizationId,
          email,
          roles,
          hashToken(token),
          actorId,
          new Date(Date.now() + invitationLifetimeMs()),
        ],
      );
      const organization = await client.query<{ name: string }>(
        'SELECT name FROM organizations WHERE id = $1',
        [organizationId],
      );
      // Sending before commit means a failed email leaves no invitation nobody received.
      await this.email.sendInvitation(email, token, organization.rows[0].name);
      return inserted.rows[0];
    });
    return { invitation, url: emailLink('invitation', token) };
  }

  /** Administrators see every pending invitation; coaches see the ones they sent. */
  async listPending(actorId: string, organizationId: string): Promise<Invitation[]> {
    return withTransaction(async (client) => {
      const roles = await actorRoles(client, organizationId, actorId);
      if (!mayFollowUpInvitations(roles)) throw new ForbiddenException();
      const { rows } = await client.query<Invitation>(
        `SELECT ${INVITATION_FIELDS} FROM organization_invitations i
         JOIN accounts inviter ON inviter.id = i.invited_by
         WHERE i.organization_id = $1 AND ${PENDING} AND ($3 OR i.invited_by = $2)
         ORDER BY i.created_at, i.id`,
        [organizationId, actorId, roles.includes('administrator')],
      );
      return rows;
    });
  }

  async revoke(actorId: string, organizationId: string, invitationId: string): Promise<void> {
    await withTransaction(async (client) => {
      const roles = await actorRoles(client, organizationId, actorId);
      assertIdentifier(invitationId);
      if (!mayFollowUpInvitations(roles)) throw new ForbiddenException();
      const { rowCount } = await client.query(
        `UPDATE organization_invitations i SET revoked_at = now()
         WHERE i.id = $1 AND i.organization_id = $2 AND ${PENDING}
           AND ($4 OR i.invited_by = $3)`,
        [invitationId, organizationId, actorId, roles.includes('administrator')],
      );
      if (!rowCount) throw new NotFoundException();
    });
  }

  /**
   * What a pending invitation offers, shown before signing in to accept it. The account
   * that already accepted it learns which organization it joined; to anyone else a used
   * invitation does not exist.
   */
  async preview(token: string, account: SignedInAccount | null): Promise<InvitationPreview> {
    const { rows } = await query<{
      organization_id: string;
      name: string;
      email: string;
      roles: MemberRole[];
      expires_at: string;
      accepted_by: string | null;
      pending: boolean;
    }>(
      `SELECT i.organization_id, o.name, i.email, i.roles, i.expires_at, i.accepted_by,
              ${PENDING} AS pending
       FROM organization_invitations i JOIN organizations o ON o.id = i.organization_id
       WHERE i.token_hash = $1`,
      [hashToken(token)],
    );
    const invitation = rows[0];
    if (account && invitation?.accepted_by === account.id) {
      const joined = await this.organizations
        .get(account.id, invitation.organization_id)
        .catch(() => null);
      if (joined) return { status: 'joined', organization: { id: joined.id, name: joined.name } };
    }
    if (!invitation?.pending) throw new NotFoundException();
    return {
      status: 'pending',
      organization: { name: invitation.name },
      email: invitation.email,
      roles: invitation.roles,
      expiresAt: invitation.expires_at,
    };
  }

  /**
   * Grants the invitation's roles to the account it was addressed to, once. Accepting
   * again from the same account answers with the organization instead of failing.
   */
  async accept(account: SignedInAccount, token: string): Promise<Organization> {
    const organizationId = await withTransaction(async (client) => {
      const found = await client.query<{ organization_id: string; invited_by: string }>(
        'SELECT organization_id, invited_by FROM organization_invitations WHERE token_hash = $1',
        [hashToken(token)],
      );
      if (!found.rows[0]) throw new NotFoundException();
      // Holding the inviter's membership keeps their roles stable while they authorize this.
      await lockMemberships(
        client,
        found.rows[0].organization_id,
        [found.rows[0].invited_by],
        'SHARE',
      );
      const { rows } = await client.query<{
        id: string;
        organization_id: string;
        email: string;
        roles: MemberRole[];
        accepted_by: string | null;
        pending: boolean;
      }>(
        `SELECT i.id, i.organization_id, i.email, i.roles, i.accepted_by, ${PENDING} AS pending
         FROM organization_invitations i WHERE i.token_hash = $1 FOR UPDATE OF i`,
        [hashToken(token)],
      );
      const invitation = rows[0];
      if (invitation?.accepted_by === account.id) return invitation.organization_id;
      if (!invitation?.pending) throw new NotFoundException();
      if (invitation.email !== normalizedEmail(account.email))
        throw new ForbiddenException('This invitation was sent to a different email address.');
      await client.query(
        `INSERT INTO organization_memberships(organization_id, account_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [invitation.organization_id, account.id],
      );
      await client.query(
        `INSERT INTO organization_membership_roles(organization_id, account_id, role)
         SELECT $1, $2, unnest($3::text[]) ON CONFLICT DO NOTHING`,
        [invitation.organization_id, account.id, invitation.roles],
      );
      await client.query(
        'UPDATE organization_invitations SET accepted_at = now(), accepted_by = $2 WHERE id = $1',
        [invitation.id, account.id],
      );
      // Other pending invitations that offer nothing new would only linger in the list.
      await client.query(
        `UPDATE organization_invitations i SET revoked_at = now()
         WHERE i.organization_id = $1 AND i.email = $2 AND ${PENDING}
           AND i.roles <@ ARRAY(
             SELECT role FROM organization_membership_roles
             WHERE organization_id = $1 AND account_id = $3)`,
        [invitation.organization_id, invitation.email, account.id],
      );
      return invitation.organization_id;
    });
    return this.organizations.get(account.id, organizationId);
  }
}

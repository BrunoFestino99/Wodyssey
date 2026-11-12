import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { query, withTransaction } from './database';
import {
  assertIdentifier,
  lockMemberships,
  MEMBER_ROLES,
  sortedRoles,
  type MemberRole,
  type OrganizationRole,
} from './organization-access';
import { OrganizationsService } from './organizations.service';

export type Member = { accountId: string; email: string; roles: OrganizationRole[] };

@Injectable()
export class MembersService {
  constructor(private readonly organizations: OrganizationsService) {}

  async list(actorId: string, organizationId: string): Promise<Member[]> {
    const { roles } = await this.organizations.get(actorId, organizationId);
    if (!roles.includes('administrator')) throw new ForbiddenException();
    const { rows } = await query<Member>(
      `SELECT m.account_id AS "accountId", a.email,
              COALESCE(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
       FROM organization_memberships m
       JOIN accounts a ON a.id = m.account_id
       LEFT JOIN organization_membership_roles r
         ON r.organization_id = m.organization_id AND r.account_id = m.account_id
       WHERE m.organization_id = $1
       GROUP BY m.account_id, a.email, m.joined_at
       ORDER BY m.joined_at, a.email`,
      [organizationId],
    );
    return rows;
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
    return withTransaction(async (client) => {
      const locked = await lockMemberships(client, organizationId, [actorId, accountId], 'UPDATE');
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
      await client.query(
        `DELETE FROM organization_membership_roles
         WHERE organization_id = $1 AND account_id = $2
           AND role = ANY($3::text[]) AND NOT role = ANY($4::text[])`,
        [organizationId, accountId, MEMBER_ROLES, memberRoles],
      );
      await client.query(
        `INSERT INTO organization_membership_roles(organization_id, account_id, role)
         SELECT $1, $2, unnest($3::text[]) ON CONFLICT DO NOTHING`,
        [organizationId, accountId, memberRoles],
      );
      const { rows } = await client.query<{ email: string }>(
        'SELECT email FROM accounts WHERE id = $1',
        [accountId],
      );
      return { accountId, email: rows[0].email, roles };
    });
  }
}

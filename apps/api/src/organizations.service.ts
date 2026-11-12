import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { query, withTransaction } from './database';

export type OrganizationRole = 'administrator';
export type Organization = { id: string; name: string; roles: OrganizationRole[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Only organizations the account belongs to are ever selected.
const MEMBER_ORGANIZATIONS = `
  SELECT o.id, o.name,
         COALESCE(array_agg(r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS roles
  FROM organizations o
  JOIN organization_memberships m ON m.organization_id = o.id AND m.account_id = $1
  LEFT JOIN organization_membership_roles r
    ON r.organization_id = m.organization_id AND r.account_id = m.account_id`;

@Injectable()
export class OrganizationsService {
  async create(accountId: string, name: string): Promise<Organization> {
    return withTransaction(async (client) => {
      const { rows } = await client.query<{ id: string; name: string }>(
        'INSERT INTO organizations(name, created_by) VALUES ($1, $2) RETURNING id, name',
        [name, accountId],
      );
      const organization = rows[0];
      await client.query(
        'INSERT INTO organization_memberships(organization_id, account_id) VALUES ($1, $2)',
        [organization.id, accountId],
      );
      await client.query(
        "INSERT INTO organization_membership_roles(organization_id, account_id, role) VALUES ($1, $2, 'administrator')",
        [organization.id, accountId],
      );
      return { ...organization, roles: ['administrator'] };
    });
  }

  async list(accountId: string): Promise<Organization[]> {
    const { rows } = await query<Organization>(
      `${MEMBER_ORGANIZATIONS} GROUP BY o.id ORDER BY o.created_at, o.id`,
      [accountId],
    );
    return rows;
  }

  /** Non-members get the same answer as for an organization that does not exist. */
  async get(accountId: string, organizationId: string): Promise<Organization> {
    if (!UUID.test(organizationId)) throw new NotFoundException();
    const { rows } = await query<Organization>(
      `${MEMBER_ORGANIZATIONS} WHERE o.id = $2 GROUP BY o.id`,
      [accountId, organizationId],
    );
    if (!rows[0]) throw new NotFoundException();
    return rows[0];
  }

  async rename(accountId: string, organizationId: string, name: string): Promise<Organization> {
    const organization = await this.get(accountId, organizationId);
    if (!organization.roles.includes('administrator')) throw new ForbiddenException();
    // The role is checked again in the write so a concurrent revocation cannot be bypassed.
    const { rows } = await query<{ name: string }>(
      `UPDATE organizations SET name = $1
       WHERE id = $2 AND EXISTS (
         SELECT 1 FROM organization_membership_roles
         WHERE organization_id = $2 AND account_id = $3 AND role = 'administrator')
       RETURNING name`,
      [name, organizationId, accountId],
    );
    if (!rows[0]) throw new ForbiddenException();
    return { ...organization, name: rows[0].name };
  }
}

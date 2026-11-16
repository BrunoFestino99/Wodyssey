import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { MEMBER_ROLES, ORGANIZATION_ROLES } from './roles';

const timestamptz = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => timestamptz('created_at').notNull().defaultNow();

/** Quoted literals for a CHECK constraint, which cannot take bound parameters. */
const literals = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

export const TOKEN_PURPOSES = ['verification', 'reset'] as const;

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash').notNull(),
    emailVerifiedAt: timestamptz('email_verified_at'),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex('accounts_email_lower_unique').on(sql`lower(${table.email})`)],
);

export const accountTokens = pgTable(
  'account_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    purpose: text('purpose', { enum: TOKEN_PURPOSES }).notNull(),
    expiresAt: timestamptz('expires_at').notNull(),
    consumedAt: timestamptz('consumed_at'),
    createdAt: createdAt(),
  },
  (table) => [
    check('account_tokens_purpose_check', sql`${table.purpose} IN (${literals(TOKEN_PURPOSES)})`),
    index('account_tokens_account_purpose').on(table.accountId, table.purpose),
  ],
);

export const accountSessions = pgTable(
  'account_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamptz('expires_at').notNull(),
    createdAt: createdAt(),
  },
  (table) => [index('account_sessions_account_id').on(table.accountId)],
);

export const organizations = pgTable(
  'organizations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    createdBy: uuid('created_by')
      .notNull()
      .references(() => accounts.id),
    createdAt: createdAt(),
  },
  (table) => [check('organizations_name_check', sql`char_length(${table.name}) BETWEEN 1 AND 80`)],
);

export const organizationMemberships = pgTable(
  'organization_memberships',
  {
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    joinedAt: timestamptz('joined_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.accountId] }),
    index('organization_memberships_account_id').on(table.accountId),
  ],
);

/** Roles are granted per membership. */
export const organizationMembershipRoles = pgTable(
  'organization_membership_roles',
  {
    organizationId: uuid('organization_id').notNull(),
    accountId: uuid('account_id').notNull(),
    role: text('role', { enum: ORGANIZATION_ROLES }).notNull(),
    grantedAt: timestamptz('granted_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.accountId, table.role] }),
    foreignKey({
      // The generated name exceeds PostgreSQL's 63-character identifier limit.
      name: 'organization_membership_roles_membership_fk',
      columns: [table.organizationId, table.accountId],
      foreignColumns: [organizationMemberships.organizationId, organizationMemberships.accountId],
    }).onDelete('cascade'),
    check(
      'organization_membership_roles_role_check',
      sql`${table.role} IN (${literals(ORGANIZATION_ROLES)})`,
    ),
  ],
);

/**
 * An invitation is addressed to one email and grants its roles once, to the verified
 * account with that email.
 */
export const organizationInvitations = pgTable(
  'organization_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    organizationId: uuid('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    roles: text('roles', { enum: MEMBER_ROLES }).array().notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    invitedBy: uuid('invited_by')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    expiresAt: timestamptz('expires_at').notNull(),
    acceptedAt: timestamptz('accepted_at'),
    acceptedBy: uuid('accepted_by').references(() => accounts.id, { onDelete: 'set null' }),
    revokedAt: timestamptz('revoked_at'),
    createdAt: createdAt(),
  },
  (table) => [
    check(
      'organization_invitations_roles_check',
      sql`cardinality(${table.roles}) BETWEEN 1 AND ${sql.raw(String(MEMBER_ROLES.length))} AND ${table.roles} <@ ARRAY[${literals(MEMBER_ROLES)}]::text[]`,
    ),
    check(
      'organization_invitations_check',
      sql`${table.acceptedAt} IS NULL OR ${table.revokedAt} IS NULL`,
    ),
    index('organization_invitations_organization_id').on(table.organizationId, table.createdAt),
  ],
);

/**
 * A responsible coach follows an athlete of the same organization. Each side references the
 * membership role it needs, so losing the coach or athlete role (or the membership) ends the
 * responsibility in the same statement.
 */
export const athleteCoaches = pgTable(
  'athlete_coaches',
  {
    organizationId: uuid('organization_id').notNull(),
    athleteId: uuid('athlete_id').notNull(),
    athleteRole: text('athlete_role', { enum: ['athlete'] })
      .notNull()
      .default('athlete'),
    coachId: uuid('coach_id').notNull(),
    coachRole: text('coach_role', { enum: ['coach'] })
      .notNull()
      .default('coach'),
    assignedAt: timestamptz('assigned_at').notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.organizationId, table.athleteId, table.coachId] }),
    foreignKey({
      name: 'athlete_coaches_athlete_role_fk',
      columns: [table.organizationId, table.athleteId, table.athleteRole],
      foreignColumns: [
        organizationMembershipRoles.organizationId,
        organizationMembershipRoles.accountId,
        organizationMembershipRoles.role,
      ],
    }).onDelete('cascade'),
    foreignKey({
      name: 'athlete_coaches_coach_role_fk',
      columns: [table.organizationId, table.coachId, table.coachRole],
      foreignColumns: [
        organizationMembershipRoles.organizationId,
        organizationMembershipRoles.accountId,
        organizationMembershipRoles.role,
      ],
    }).onDelete('cascade'),
    check('athlete_coaches_athlete_role_check', sql`${table.athleteRole} = 'athlete'`),
    check('athlete_coaches_coach_role_check', sql`${table.coachRole} = 'coach'`),
    index('athlete_coaches_coach').on(table.organizationId, table.coachId),
  ],
);

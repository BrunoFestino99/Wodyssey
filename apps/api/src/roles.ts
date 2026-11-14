/** Roles granted through invitations and member management; administrators are not invited. */
export const MEMBER_ROLES = ['athlete', 'coach'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

/** Roles a membership can hold in an organization. */
export const ORGANIZATION_ROLES = ['administrator', ...MEMBER_ROLES] as const;
export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

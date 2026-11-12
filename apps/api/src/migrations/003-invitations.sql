ALTER TABLE organization_membership_roles
  DROP CONSTRAINT organization_membership_roles_role_check,
  ADD CONSTRAINT organization_membership_roles_role_check
    CHECK (role IN ('administrator', 'coach', 'athlete'));

-- An invitation is addressed to one email and grants its roles once, to the
-- verified account with that email.
CREATE TABLE organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  roles text[] NOT NULL CHECK (
    cardinality(roles) BETWEEN 1 AND 2 AND roles <@ ARRAY['coach', 'athlete']::text[]
  ),
  token_hash text NOT NULL UNIQUE,
  invited_by uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  accepted_by uuid REFERENCES accounts(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (accepted_at IS NULL OR revoked_at IS NULL)
);
CREATE INDEX organization_invitations_organization_id
  ON organization_invitations (organization_id, created_at);

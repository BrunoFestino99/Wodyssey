CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE organization_memberships (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, account_id)
);
CREATE INDEX organization_memberships_account_id ON organization_memberships (account_id);

-- Roles are granted per membership; later slices extend the allowed values.
CREATE TABLE organization_membership_roles (
  organization_id uuid NOT NULL,
  account_id uuid NOT NULL,
  role text NOT NULL CHECK (role IN ('administrator')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, account_id, role),
  FOREIGN KEY (organization_id, account_id)
    REFERENCES organization_memberships (organization_id, account_id) ON DELETE CASCADE
);

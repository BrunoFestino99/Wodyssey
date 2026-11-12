import { useCallback, useRef, useState } from 'react';
import { MEMBER_ROLES, request, type Member, type MemberRole, type OrganizationRole } from './api';
import {
  ActionForm,
  LoadedPanel,
  signedIn,
  useSignedInLoad,
  type SignedInLoad,
} from './components';
import { copy } from './copy';

const ROLE_ORDER: readonly OrganizationRole[] = ['administrator', 'coach', 'athlete'];

export function RoleChips({ roles, label }: { roles: OrganizationRole[]; label: string }) {
  const ordered = ROLE_ORDER.filter((role) => roles.includes(role));
  return (
    <ul className="roles" aria-label={label}>
      {ordered.map((role) => (
        <li key={role} className="role-chip">
          {copy.organizations.roles[role]}
        </li>
      ))}
    </ul>
  );
}

export function RoleCheckboxes({
  legend,
  accessibleName,
  checked,
}: {
  legend: string;
  /** Overrides the legend for assistive technology when it needs more context. */
  accessibleName?: string;
  checked: MemberRole[];
}) {
  return (
    <fieldset className="checkboxes" aria-label={accessibleName}>
      <legend>{legend}</legend>
      {MEMBER_ROLES.map((role) => (
        <label key={role} className="checkbox">
          <input
            type="checkbox"
            name="roles"
            value={role}
            defaultChecked={checked.includes(role)}
          />
          {copy.organizations.roles[role]}
        </label>
      ))}
    </fieldset>
  );
}

export const checkedRoles = (data: FormData) => data.getAll('roles').map(String) as MemberRole[];

function MemberEntry({
  organizationId,
  member,
  self,
  onChanged,
}: {
  organizationId: string;
  member: Member;
  self: boolean;
  onChanged: (member: Member) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const memberRoles = member.roles.filter((role): role is MemberRole => role !== 'administrator');
  const close = () => {
    setEditing(false);
    // Return focus to the control that opened the form once it is rendered again.
    requestAnimationFrame(() => editButton.current?.focus());
  };
  return (
    <li className="entry">
      <div className="entry-details">
        <p className="entry-title">
          {member.email}
          {self && <span className="entry-tag">{copy.members.selfTag}</span>}
        </p>
        <RoleChips roles={member.roles} label={copy.members.rolesOf(member.email)} />
        {saved && !editing && (
          <p className="success entry-feedback" role="status">
            {copy.members.saved(member.email)}
          </p>
        )}
      </div>
      {editing ? (
        <div className="entry-editor">
          <ActionForm
            label={copy.members.save}
            validationMessage={copy.members.atLeastOneRole}
            action={async (data) => {
              const updated = await signedIn(() =>
                request<Member>(
                  `/organizations/${encodeURIComponent(organizationId)}/members/${encodeURIComponent(member.accountId)}`,
                  { roles: checkedRoles(data) },
                  'PATCH',
                ),
              );
              if (!updated) return;
              onChanged(updated);
              setSaved(true);
              close();
            }}
          >
            <RoleCheckboxes
              legend={copy.members.rolesLegend}
              accessibleName={copy.members.editRolesOf(member.email)}
              checked={memberRoles}
            />
          </ActionForm>
          <button className="text-button" type="button" onClick={close}>
            {copy.members.cancel}
          </button>
        </div>
      ) : (
        <div className="entry-actions">
          <button
            ref={editButton}
            className="secondary"
            type="button"
            aria-label={copy.members.editRolesOf(member.email)}
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
          >
            {copy.members.editRoles}
          </button>
        </div>
      )}
    </li>
  );
}

/** Administrators review members and set their coach and athlete roles. */
export function MembersSection({
  organizationId,
  accountEmail,
  onOwnRolesChanged,
}: {
  organizationId: string;
  accountEmail: string;
  onOwnRolesChanged: (roles: OrganizationRole[]) => void;
}) {
  const loadMembers = useCallback(
    () => request<Member[]>(`/organizations/${encodeURIComponent(organizationId)}/members`),
    [organizationId],
  );
  const load = useSignedInLoad(loadMembers);
  const [updated, setUpdated] = useState<Record<string, Member>>({});
  const membersLoad: SignedInLoad<Member[]> =
    load.state === 'ready'
      ? { state: 'ready', data: load.data.map((member) => updated[member.accountId] ?? member) }
      : load;
  return (
    <LoadedPanel
      labelledBy="organization-members"
      title={copy.members.title}
      description={copy.members.description}
      load={membersLoad}
      failure={copy.members.loadFailed}
    >
      {(members) => (
        <ul className="entry-list">
          {members.map((member) => {
            const self = member.email.toLowerCase() === accountEmail.toLowerCase();
            return (
              <MemberEntry
                key={member.accountId}
                organizationId={organizationId}
                member={member}
                self={self}
                onChanged={(changed) => {
                  setUpdated((current) => ({ ...current, [changed.accountId]: changed }));
                  if (self) onOwnRolesChanged(changed.roles);
                }}
              />
            );
          })}
        </ul>
      )}
    </LoadedPanel>
  );
}

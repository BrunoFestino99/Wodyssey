import { useCallback, useId, useRef, useState } from 'react';
import { request, type Invitation, type SentInvitation } from './api';
import {
  ActionForm,
  LoadedPanel,
  signedIn,
  useSignedInLoad,
  type SignedInLoad,
} from './components';
import { copy } from './copy';
import { checkedRoles, RoleCheckboxes, RoleChips } from './members';

const expiryFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function InviteForm({
  organizationId,
  administrator,
  onSent,
}: {
  organizationId: string;
  administrator: boolean;
  onSent: (sent: SentInvitation) => void;
}) {
  const [sent, setSent] = useState<SentInvitation>();
  const [copied, setCopied] = useState(false);
  const emailId = useId();
  const linkId = useId();
  const link = useRef<HTMLInputElement>(null);
  return (
    <>
      <ActionForm
        // A new form after each invitation starts the next one empty.
        key={sent?.invitation.id}
        label={copy.invitations.send}
        validationMessage={copy.invitations.invalid}
        statusMessages={{ 403: copy.invitations.notAllowed, 409: copy.invitations.alreadyMember }}
        action={async (data) => {
          setSent(undefined);
          setCopied(false);
          const result = await signedIn(() =>
            request<SentInvitation>(
              `/organizations/${encodeURIComponent(organizationId)}/invitations`,
              {
                email: String(data.get('email')).trim(),
                roles: administrator ? checkedRoles(data) : ['athlete'],
              },
            ),
          );
          if (!result) return;
          setSent(result);
          onSent(result);
        }}
      >
        <label htmlFor={emailId}>{copy.email}</label>
        <input id={emailId} name="email" type="email" autoComplete="off" required maxLength={254} />
        {administrator && (
          <RoleCheckboxes legend={copy.invitations.rolesLegend} checked={['athlete']} />
        )}
      </ActionForm>
      {sent && (
        <div className="invitation-sent">
          <p className="success" role="status">
            {copy.invitations.sent(sent.invitation.email)}
          </p>
          <label htmlFor={linkId}>{copy.invitations.linkLabel}</label>
          <div className="copy-field">
            <input
              ref={link}
              id={linkId}
              type="text"
              readOnly
              value={sent.url}
              aria-describedby={`${linkId}-hint`}
              onFocus={(event) => event.currentTarget.select()}
            />
            <button
              className="secondary"
              type="button"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(sent.url);
                  setCopied(true);
                } catch {
                  // Without clipboard access, select the link so it can be copied by hand.
                  link.current?.select();
                }
              }}
            >
              {copy.invitations.copyLink}
            </button>
          </div>
          <p id={`${linkId}-hint`} className="hint">
            {copy.invitations.linkHint}
          </p>
          <p className="visually-hidden" role="status">
            {copied ? copy.invitations.copied : ''}
          </p>
        </div>
      )}
    </>
  );
}

function PendingInvitations({
  organizationId,
  invitations,
  onRevoked,
}: {
  organizationId: string;
  invitations: Invitation[];
  onRevoked: (invitation: Invitation) => void;
}) {
  if (invitations.length === 0)
    return <p className="panel-empty">{copy.invitations.pendingEmpty}</p>;
  return (
    <ul className="entry-list">
      {invitations.map((invitation) => (
        <li key={invitation.id} className="entry">
          <div className="entry-details">
            <p className="entry-title">{invitation.email}</p>
            <RoleChips roles={invitation.roles} label={copy.members.rolesOf(invitation.email)} />
            <p className="entry-meta">
              {copy.invitations.invitedBy(
                invitation.invitedBy,
                expiryFormat.format(new Date(invitation.expiresAt)),
              )}
            </p>
          </div>
          <div className="entry-actions">
            <ActionForm
              secondary
              label={copy.invitations.revoke}
              ariaLabel={copy.invitations.revokeLabel(invitation.email)}
              action={async () => {
                await signedIn(async () => {
                  await request(
                    `/organizations/${encodeURIComponent(organizationId)}/invitations/${encodeURIComponent(invitation.id)}`,
                    undefined,
                    'DELETE',
                  );
                  onRevoked(invitation);
                });
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Invitation form plus the pending invitations the viewer can follow up on. */
export function InvitationsSection({
  organizationId,
  administrator,
}: {
  organizationId: string;
  administrator: boolean;
}) {
  const loadPending = useCallback(
    () => request<Invitation[]>(`/organizations/${encodeURIComponent(organizationId)}/invitations`),
    [organizationId],
  );
  const load = useSignedInLoad(loadPending);
  const [changes, setChanges] = useState<{ added: Invitation[]; removed: string[] }>({
    added: [],
    removed: [],
  });
  const [revoked, setRevoked] = useState('');
  const pendingLoad: SignedInLoad<Invitation[]> =
    load.state === 'ready'
      ? {
          state: 'ready',
          data: [...load.data, ...changes.added].filter(({ id }) => !changes.removed.includes(id)),
        }
      : load;
  return (
    <>
      <section className="panel" aria-labelledby="invite-members">
        <h2 id="invite-members">
          {administrator ? copy.invitations.inviteTitle : copy.invitations.inviteAthletesTitle}
        </h2>
        <p className="panel-description">
          {administrator
            ? copy.invitations.inviteDescription
            : copy.invitations.athleteOnlyDescription}
        </p>
        <InviteForm
          organizationId={organizationId}
          administrator={administrator}
          onSent={({ invitation }) => {
            setRevoked('');
            // Resending replaces the sender's earlier invitation with the same address and roles.
            const replaced = (pendingLoad.state === 'ready' ? pendingLoad.data : [])
              .filter(
                (earlier) =>
                  earlier.email === invitation.email &&
                  earlier.invitedBy === invitation.invitedBy &&
                  earlier.roles.join() === invitation.roles.join(),
              )
              .map(({ id }) => id);
            setChanges((current) => ({
              added: [...current.added, invitation],
              removed: [...current.removed, ...replaced],
            }));
          }}
        />
      </section>
      <LoadedPanel
        labelledBy="pending-invitations"
        title={copy.invitations.pendingTitle}
        load={pendingLoad}
        failure={copy.invitations.loadFailed}
      >
        {(invitations) => (
          <>
            <PendingInvitations
              organizationId={organizationId}
              invitations={invitations}
              onRevoked={(invitation) => {
                setRevoked(copy.invitations.revoked(invitation.email));
                setChanges((current) => ({
                  ...current,
                  removed: [...current.removed, invitation.id],
                }));
              }}
            />
            {revoked && (
              <p className="success" role="status">
                {revoked}
              </p>
            )}
          </>
        )}
      </LoadedPanel>
    </>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { ApiError, request, type Account, type InvitationPreview, type Organization } from './api';
import { ActionForm, Card, CardPage, PendingLoad, SignOutForm, signedIn } from './components';
import { copy } from './copy';
import { RoleChips } from './members';
import { forgetInvitation, invitationPath, rememberInvitation } from './pending-invitation';

type PendingInvitation = Extract<InvitationPreview, { status: 'pending' }>;
type InvitationState =
  | { state: 'loading' }
  | { state: 'failed' }
  | { state: 'unavailable' }
  | { state: 'joined'; organization: { id: string; name: string } }
  | { state: 'ready'; invitation: PendingInvitation; account: Account | null };

const organizationPath = (id: string) => `/organizations/${encodeURIComponent(id)}`;

async function loadInvitation(token: string): Promise<InvitationState> {
  const [invitation, account] = await Promise.all([
    request<InvitationPreview>('/invitations/preview', { token }).catch((error: unknown) => {
      if (error instanceof ApiError && (error.status === 404 || error.status === 400)) return null;
      throw error;
    }),
    request<Account>('/auth/me').catch((error: unknown) => {
      if (error instanceof ApiError && error.status === 401) return null;
      throw error;
    }),
  ]);
  if (!invitation) return { state: 'unavailable' };
  if (invitation.status === 'joined')
    return { state: 'joined', organization: invitation.organization };
  return { state: 'ready', invitation, account };
}

/** Shows what an invitation offers and lets the invited account accept it. */
export function AcceptInvitation() {
  const token = new URLSearchParams(window.location.search).get('token');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<InvitationState>({ state: 'loading' });
  const load = useCallback(
    () =>
      token ? loadInvitation(token) : Promise.resolve<InvitationState>({ state: 'unavailable' }),
    [token],
  );
  useEffect(() => {
    let cancelled = false;
    setResult({ state: 'loading' });
    load()
      .then((loaded) => {
        if (!cancelled) setResult(loaded);
      })
      .catch(() => {
        if (!cancelled) setResult({ state: 'failed' });
      });
    return () => {
      cancelled = true;
    };
  }, [load, attempt]);
  useEffect(() => {
    if (result.state === 'unavailable' || result.state === 'joined') forgetInvitation();
    // Signing in or registering may take a detour through email verification.
    if (result.state === 'ready' && token) rememberInvitation(token);
  }, [result, token]);

  if (result.state === 'loading') return <PendingLoad load={{ state: 'loading' }} />;
  if (result.state === 'failed')
    return <PendingLoad load={{ state: 'failed', retry: () => setAttempt(attempt + 1) }} />;
  if (result.state === 'joined')
    return (
      <CardPage>
        <Card
          eyebrow={copy.invitations.eyebrow}
          title={copy.invitations.joinedTitle(result.organization.name)}
        >
          <p className="lede">{copy.invitations.joinedDescription}</p>
          <a className="primary button-link" href={organizationPath(result.organization.id)}>
            {copy.invitations.openOrganization(result.organization.name)}
          </a>
        </Card>
      </CardPage>
    );
  if (result.state === 'unavailable' || !token)
    return (
      <CardPage>
        <Card eyebrow={copy.invitations.eyebrow} title={copy.invitations.unavailableTitle}>
          <p className="lede">{copy.invitations.unavailableDescription}</p>
          <a className="primary button-link" href="/home">
            {copy.returnHome}
          </a>
        </Card>
      </CardPage>
    );
  return (
    <CardPage>
      <InvitationCard
        token={token}
        invitation={result.invitation}
        account={result.account}
        onUnavailable={() => setResult({ state: 'unavailable' })}
      />
    </CardPage>
  );
}

function InvitationCard({
  token,
  invitation,
  account,
  onUnavailable,
}: {
  token: string;
  invitation: PendingInvitation;
  account: Account | null;
  onUnavailable: () => void;
}) {
  const invitedEmail = encodeURIComponent(invitation.email);
  const intended = account?.email.toLowerCase() === invitation.email.toLowerCase();
  return (
    <Card
      eyebrow={copy.invitations.eyebrow}
      title={copy.invitations.joinTitle(invitation.organization.name)}
    >
      <p className="lede invitation-roles-lede">{copy.invitations.joinAs}</p>
      <RoleChips roles={invitation.roles} label={copy.invitations.offeredRoles} />
      <p className="account-email invitation-email">
        {copy.invitations.sentTo} <strong>{invitation.email}</strong>
      </p>
      {!account && (
        <>
          <p className="lede">{copy.invitations.signInToAccept}</p>
          <div className="stacked-actions">
            <a className="primary button-link" href={`/login?email=${invitedEmail}`}>
              {copy.invitations.signIn}
            </a>
            <a className="secondary button-link" href={`/register?email=${invitedEmail}`}>
              {copy.invitations.createAccount}
            </a>
          </div>
        </>
      )}
      {account && !intended && (
        <>
          <p className="error" role="alert">
            {copy.invitations.wrongAccount(invitation.email, account.email)}
          </p>
          <SignOutForm next={invitationPath(token)} />
        </>
      )}
      {account && intended && (
        <ActionForm
          label={copy.invitations.accept}
          action={async () => {
            try {
              const organization = await signedIn(() =>
                request<Organization>('/invitations/accept', { token }),
              );
              if (!organization) return;
              forgetInvitation();
              window.location.assign(organizationPath(organization.id));
            } catch (error) {
              if (error instanceof ApiError && (error.status === 404 || error.status === 403)) {
                onUnavailable();
                return;
              }
              throw error;
            }
          }}
        />
      )}
      <p className="switch">
        <a href="/home" onClick={forgetInvitation}>
          {copy.invitations.notNow}
        </a>
      </p>
    </Card>
  );
}

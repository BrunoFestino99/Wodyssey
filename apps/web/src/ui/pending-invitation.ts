const PENDING_INVITATION_KEY = 'wodyssey:pending-invitation';

export const invitationPath = (token: string) => `/invitations?token=${encodeURIComponent(token)}`;

/** Keeps an opened invitation while its visitor signs in or registers, possibly in another tab. */
export function rememberInvitation(token: string): void {
  try {
    localStorage.setItem(PENDING_INVITATION_KEY, token);
  } catch {
    // Without storage, the invitation link still works when opened again.
  }
}

export function forgetInvitation(): void {
  try {
    localStorage.removeItem(PENDING_INVITATION_KEY);
  } catch {
    // Nothing was remembered.
  }
}

/** Where to go after signing in: a remembered invitation, or home. */
export function pathAfterSignIn(): string {
  try {
    const token = localStorage.getItem(PENDING_INVITATION_KEY);
    if (token) return invitationPath(token);
  } catch {
    // Fall through to home.
  }
  return '/home';
}

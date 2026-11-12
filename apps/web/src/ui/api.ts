const origin = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`Request failed (${status})`);
  }
}

export async function request<T = void>(
  path: string,
  body?: unknown,
  method: 'GET' | 'POST' | 'PATCH' = body === undefined ? 'GET' : 'POST',
): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    method,
    credentials: 'include',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

/** Sends a signed-out visitor to the sign-in form; returns whether it did. */
export function redirectIfSignedOut(error: unknown): boolean {
  if (!(error instanceof ApiError) || error.status !== 401) return false;
  window.location.replace('/login');
  return true;
}

export type Account = { email: string };
export type OrganizationRole = 'administrator';
export type Organization = { id: string; name: string; roles: OrganizationRole[] };

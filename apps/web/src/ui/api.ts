const origin = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

export class ApiError extends Error {
  constructor(readonly status: number) {
    super(`Account request failed (${status})`);
  }
}

export async function request<T = void>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`${origin}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) throw new ApiError(response.status);
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

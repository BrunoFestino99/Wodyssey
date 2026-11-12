import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext } from '@playwright/test';

export const api = process.env.E2E_API_ORIGIN ?? 'http://127.0.0.1:3000';
export const password = 'Strong-password-42!';

export function uniqueEmail(prefix: string): string {
  return `${prefix}-${randomUUID()}@example.test`;
}

export async function messagesFor(
  request: APIRequestContext,
  email: string,
): Promise<Array<{ type: string; token: string; url: string }>> {
  const response = await request.get(`${api}/auth/test/mailbox?email=${encodeURIComponent(email)}`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

export async function verifiedAccount(request: APIRequestContext): Promise<string> {
  const email = uniqueEmail('account');
  expect((await request.post(`${api}/auth/register`, { data: { email, password } })).status()).toBe(
    202,
  );
  const [message] = await messagesFor(request, email);
  expect(
    (
      await request.post(`${api}/auth/verification/consume`, { data: { token: message.token } })
    ).status(),
  ).toBe(200);
  return email;
}

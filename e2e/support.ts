import { randomUUID } from 'node:crypto';
import { expect, type APIRequestContext, type Page } from '@playwright/test';

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

export async function signedInClient(
  playwright: Playwright,
  setup: APIRequestContext,
): Promise<APIRequestContext> {
  return signedInAs(playwright, await verifiedAccount(setup));
}

/** Signs in through the web form and waits for the signed-in landing screen. */
export async function signIn(page: Page, email: string, value = password) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(value);
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Your training space' })).toBeVisible();
}

export type Playwright = { request: { newContext(): Promise<APIRequestContext> } };

/** An API client signed in as an existing verified account. */
export async function signedInAs(playwright: Playwright, email: string) {
  const client = await playwright.request.newContext();
  expect((await client.post(`${api}/auth/login`, { data: { email, password } })).status()).toBe(
    200,
  );
  return client;
}

/** Signs in through the web form as a member, which resumes their organization. */
export async function signInToOrganization(page: Page, email: string, organization: string) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: organization, level: 1 })).toBeVisible();
}

import { expect, test, type APIRequestContext } from '@playwright/test';

const api = 'http://127.0.0.1:3000';
const password = 'Long-and-secure-Password-42!';
const testTokenLifetimeMs = Number(process.env.TEST_ACCOUNT_TOKEN_LIFETIME_MS ?? 3000);

async function waitForTokenExpiry(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, testTokenLifetimeMs + 300));
}

async function emailToken(request: APIRequestContext, email: string, type: string): Promise<string> {
  const response = await request.get(`${api}/test/mailbox?email=${encodeURIComponent(email)}`);
  expect(response.ok()).toBeTruthy();
  const messages = await response.json() as Array<{ type: string; token: string }>;
  const message = messages.find((item) => item.type === type);
  expect(message).toBeDefined();
  return message!.token;
}

test('expired verification and password reset links are rejected', async ({ request }) => {
  const unverifiedEmail = `expired-verification-${Date.now()}@example.test`;
  expect((await request.post(`${api}/auth/register`, { data: { email: unverifiedEmail, password } })).status()).toBe(202);
  const verificationToken = await emailToken(request, unverifiedEmail, 'verification');
  await waitForTokenExpiry();
  expect((await request.post(`${api}/auth/verification/consume`, { data: { token: verificationToken } })).status()).toBe(400);
  expect((await request.post(`${api}/auth/login`, { data: { email: unverifiedEmail, password } })).status()).toBe(401);

  const resetEmail = `expired-reset-${Date.now()}@example.test`;
  expect((await request.post(`${api}/auth/register`, { data: { email: resetEmail, password } })).status()).toBe(202);
  const setupToken = await emailToken(request, resetEmail, 'verification');
  expect((await request.post(`${api}/auth/verification/consume`, { data: { token: setupToken } })).ok()).toBeTruthy();
  expect((await request.post(`${api}/auth/password/forgot`, { data: { email: resetEmail } })).status()).toBe(202);
  const resetToken = await emailToken(request, resetEmail, 'reset');
  await waitForTokenExpiry();
  expect((await request.post(`${api}/auth/password/reset`, { data: { token: resetToken, password: 'Replacement-password-43!' } })).status()).toBe(400);
  expect((await request.post(`${api}/auth/login`, { data: { email: resetEmail, password } })).ok()).toBeTruthy();
});

import { expect, test } from '@playwright/test';

const api = 'http://127.0.0.1:3000';

test('a visitor registers, verifies email, signs in, and signs out', async ({ page, request }) => {
  const email = `athlete-${Date.now()}@example.test`;
  await page.goto('/register');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Strong-password-42!');
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();

  const mailbox = await request.get(`${api}/test/mailbox?email=${encodeURIComponent(email)}`);
  expect(mailbox.ok()).toBeTruthy();
  const messages = await mailbox.json() as Array<{ type: string; token: string }>;
  const verification = messages.find((message) => message.type === 'verification');
  expect(verification).toBeDefined();

  await page.goto(`/verify?token=${verification!.token}`);
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
  const reusedVerification = await request.post(`${api}/auth/verification/consume`, { data: { token: verification!.token } });
  expect(reusedVerification.status()).toBe(400);
  const invalidVerification = await request.post(`${api}/auth/verification/consume`, { data: { token: 'x'.repeat(48) } });
  expect(invalidVerification.status()).toBe(400);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Strong-password-42!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your training space' })).toBeVisible();
  const sessionCookie = (await page.context().cookies()).find((cookie) => cookie.name === 'wodyssey_session');
  expect(sessionCookie).toBeDefined();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect((await request.get(`${api}/auth/me`, { headers: { cookie: `wodyssey_session=${sessionCookie!.value}` } })).status()).toBe(401);
});

test('registration remains usable on a narrow phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/register');
  await expect(page.getByRole('heading', { name: 'Create your account' })).toBeVisible();
  expect(await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('concurrent link requests leave only the latest verification and reset link usable', async ({ request }) => {
  const email = `concurrent-${Date.now()}@example.test`;
  const password = 'Strong-password-42!';
  const registrations = await Promise.all([
    request.post(`${api}/auth/register`, { data: { email, password } }),
    request.post(`${api}/auth/register`, { data: { email, password } }),
  ]);
  expect(registrations.map((response) => response.status())).toEqual([202, 202]);

  const verificationMessages = await (await request.get(`${api}/test/mailbox?email=${encodeURIComponent(email)}`)).json() as Array<{ type: string; token: string }>;
  const verificationTokens = verificationMessages.filter((message) => message.type === 'verification').map((message) => message.token);
  expect(verificationTokens.length).toBe(2);
  const verificationResults = await Promise.all(verificationTokens.map((token) => request.post(`${api}/auth/verification/consume`, { data: { token } })));
  expect(verificationResults.filter((response) => response.status() === 200)).toHaveLength(1);
  expect(verificationResults.filter((response) => response.status() === 400)).toHaveLength(1);

  await Promise.all([
    request.post(`${api}/auth/password/forgot`, { data: { email } }),
    request.post(`${api}/auth/password/forgot`, { data: { email } }),
  ]);
  const resetMessages = await (await request.get(`${api}/test/mailbox?email=${encodeURIComponent(email)}`)).json() as Array<{ type: string; token: string }>;
  const resetTokens = resetMessages.filter((message) => message.type === 'reset').map((message) => message.token);
  expect(resetTokens.length).toBe(2);
  const resetResults = await Promise.all(resetTokens.map((token, index) => request.post(`${api}/auth/password/reset`, {
    data: { token, password: `Replacement-password-${index + 51}!` },
  })));
  expect(resetResults.filter((response) => response.status() === 200)).toHaveLength(1);
  expect(resetResults.filter((response) => response.status() === 400)).toHaveLength(1);
});

test('password reset tokens are single use and do not reveal unknown accounts', async ({ page, request }) => {
  const email = `reset-${Date.now()}@example.test`;
  await page.goto('/register');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill('Strong-password-42!');
  await page.getByRole('button', { name: 'Create account' }).click();
  const registrationMessages = await (await request.get(`${api}/test/mailbox?email=${encodeURIComponent(email)}`)).json() as Array<{ token: string }>;
  await page.goto(`/verify?token=${registrationMessages[0].token}`);
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();

  await page.goto('/login');
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByText('If an account exists for that address,')).toBeVisible();
  const messages = await (await request.get(`${api}/test/mailbox?email=${encodeURIComponent(email)}`)).json() as Array<{ type: string; token: string }>;
  const reset = messages.find((message) => message.type === 'reset');
  expect(reset).toBeDefined();
  const invalidReset = await request.post(`${api}/auth/password/reset`, { data: { token: 'x'.repeat(48), password: 'Third-strong-44!' } });
  expect(invalidReset.status()).toBe(400);

  await page.goto(`/reset?token=${reset!.token}`);
  await page.getByLabel('New password').fill('Another-strong-43!');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
  const replay = await request.post(`${api}/auth/password/reset`, { data: { token: reset!.token, password: 'Third-strong-44!' } });
  expect(replay.status()).toBe(400);
  const oldPassword = await request.post(`${api}/auth/login`, { data: { email, password: 'Strong-password-42!' } });
  expect(oldPassword.status()).toBe(401);
  const newPassword = await request.post(`${api}/auth/login`, { data: { email, password: 'Another-strong-43!' } });
  expect(newPassword.ok()).toBeTruthy();

  const unknownAccount = await request.post(`${api}/auth/password/forgot`, { data: { email: `unknown-${Date.now()}@example.test` } });
  expect(unknownAccount.status()).toBe(202);
  expect(await unknownAccount.json()).toEqual({ message: 'If an account exists for that address, a reset link has been sent.' });
});

import { expect, test, type Page } from '@playwright/test';
import { api, messagesFor, password, uniqueEmail, verifiedAccount } from './support';

async function signIn(page: Page, email: string, value = password) {
  await page.goto('/login');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(value);
  await page.getByLabel('Password', { exact: true }).press('Enter');
  await expect(page.getByRole('heading', { name: 'Your training space' })).toBeVisible();
}

test.afterEach(async ({ page }, testInfo) => {
  expect(
    await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('screen.png'), fullPage: true });
});

test('opening the alternate local hostname reaches the sign-in form without an error', async ({
  page,
  baseURL,
}) => {
  const alternate = new URL(baseURL!);
  alternate.hostname = alternate.hostname === 'localhost' ? '127.0.0.1' : 'localhost';
  await page.goto(alternate.toString());
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByLabel('Email address').fill('visitor@example.test');
  await expect(page.getByLabel('Email address')).toHaveValue('visitor@example.test');
});

test('the email owner can register over an unverified account with their own password', async ({
  page,
  request,
}) => {
  const email = uniqueEmail('owner');
  await request.post(api + '/auth/register', {
    data: { email, password: 'Attacker-password-42!' },
  });
  const [oldMessage] = await messagesFor(request, email);
  await page.goto('/register');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const messages = await messagesFor(request, email);
  await page.goto(messages[messages.length - 1].url);
  await page.getByRole('button', { name: 'Verify email' }).click();
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
  await signIn(page, email);
  expect(
    (
      await request.post(api + '/auth/login', {
        data: { email, password: 'Attacker-password-42!' },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post(api + '/auth/verification/consume', { data: { token: oldMessage.token } })
    ).status(),
  ).toBe(400);
});

test('a visitor registers, resends email, verifies, signs in and revokes their session', async ({
  page,
  request,
}, testInfo) => {
  const email = uniqueEmail('athlete');
  await page.goto('/register');
  await page.screenshot({ path: testInfo.outputPath('register.png'), fullPage: true });
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Email address').press('Tab');
  await expect(page.getByLabel('Password', { exact: true })).toBeFocused();
  await page.keyboard.type(password);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  await page.getByRole('button', { name: 'Resend verification link' }).click();
  await expect(page.getByRole('status')).toContainText('sent another link');

  const messages = await messagesFor(request, email);
  expect(messages).toHaveLength(2);
  // The earlier email must still work when delivery order differs from request order.
  const verification = messages[0];
  await page.goto(verification.url);
  await page.getByRole('button', { name: 'Verify email' }).click();
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();
  for (const message of messages) {
    expect(
      (
        await request.post(api + '/auth/verification/consume', { data: { token: message.token } })
      ).status(),
    ).toBe(400);
  }
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your training space' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Your training space' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('private.png'), fullPage: true });
  const sessionCookie = (await page.context().cookies()).find(
    (cookie) => cookie.name === 'wodyssey_session',
  )!;
  expect(sessionCookie.httpOnly).toBe(true);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(
    (
      await request.get(api + '/auth/me', {
        headers: { cookie: 'wodyssey_session=' + sessionCookie.value },
      })
    ).status(),
  ).toBe(401);
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('password recovery restores access with the new password and rejects reused links', async ({
  page,
  request,
}, testInfo) => {
  const email = uniqueEmail('recovery');
  await page.goto('/register');
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Create account' }).click();
  await expect(page.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const [verification] = await messagesFor(request, email);
  await page.goto(verification.url);
  await page.getByRole('button', { name: 'Verify email' }).click();
  await expect(page.getByRole('heading', { name: 'Email verified' })).toBeVisible();

  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByRole('link', { name: 'Forgot password?' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('If an account exists for that address');
  const reset = (await messagesFor(request, email)).find((message) => message.type === 'reset')!;
  await page.goto(reset.url);
  await page.screenshot({ path: testInfo.outputPath('reset.png'), fullPage: true });
  await page.getByLabel('New password').fill('Another-strong-43!');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('heading', { name: 'Password updated' })).toBeVisible();
  expect(
    (
      await request.post(api + '/auth/password/reset', {
        data: { token: reset.token, password: 'Third-strong-44!' },
      })
    ).status(),
  ).toBe(400);
  await page.getByRole('link', { name: 'Sign in' }).click();
  await page.getByLabel('Email address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Email or password is incorrect');
  await expect(page.getByLabel('Email address')).toHaveValue(email);
  await page.getByLabel('Password', { exact: true }).fill('Another-strong-43!');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your training space' })).toBeVisible();
});

test('invalid email and recovery links offer a usable way to request another', async ({ page }) => {
  await page.goto('/verify?token=' + 'x'.repeat(48));
  await page.getByRole('button', { name: 'Verify email' }).click();
  await expect(page.getByRole('heading', { name: 'This link can’t be used' })).toBeVisible();
  await page.getByLabel('Email address').fill(uniqueEmail('unknown'));
  await page.getByRole('button', { name: 'Resend verification link' }).click();
  await expect(page.getByRole('status')).toContainText('If verification is needed');

  await page.goto('/reset?token=' + 'x'.repeat(48));
  await page.getByLabel('New password').fill('Another-strong-43!');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByRole('heading', { name: 'This link can’t be used' })).toBeVisible();
  await page.getByRole('link', { name: 'Request a new reset link' }).click();
  await page.getByLabel('Email address').fill(uniqueEmail('unknown'));
  await page.getByRole('button', { name: 'Send reset link' }).click();
  await expect(page.getByRole('status')).toContainText('If an account exists for that address');
});

test('a failed sign-out is shown as an error and can be retried', async ({ page, request }) => {
  const email = await verifiedAccount(request);
  await signIn(page, email);
  await page.route('**/auth/logout', (route) => route.abort('failed'));
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('alert')).toContainText('Check your connection');
  await expect(page.getByRole('heading', { name: 'Your training space' })).toBeVisible();
  await page.unroute('**/auth/logout');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

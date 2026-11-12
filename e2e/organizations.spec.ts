import { expect, test } from '@playwright/test';
import { api, signedInClient, signIn, verifiedAccount } from './support';

test.afterEach(async ({ page }, testInfo) => {
  expect(
    await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('screen.png'), fullPage: true });
});

test('an account creates, renames and switches between the organizations it administers', async ({
  page,
  request,
}, testInfo) => {
  const email = await verifiedAccount(request);
  await signIn(page, email);
  await page.screenshot({ path: testInfo.outputPath('no-organizations.png'), fullPage: true });

  await page.getByLabel('Organization name').fill('Northside Training');
  await page.getByLabel('Organization name').press('Enter');
  await expect(page.getByRole('heading', { name: 'Northside Training' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Your roles' })).toHaveText('Administrator');
  // A single organization is a plain label, not a selector.
  await expect(page.getByRole('button', { name: /Switch organization/ })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Northside Training' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('workspace.png'), fullPage: true });

  await page.getByLabel('Organization name').fill('Northside Strength');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status')).toContainText('Changes saved');
  await expect(page.getByRole('heading', { name: 'Northside Strength' })).toBeVisible();

  await page.getByRole('button', { name: `Account: ${email}` }).click();
  await page.screenshot({ path: testInfo.outputPath('account-menu.png'), fullPage: true });
  await page.getByRole('link', { name: 'New organization' }).click();
  await expect(page.getByRole('heading', { name: 'Create an organization' })).toBeVisible();
  await page.getByLabel('Organization name').fill('Southside Coaching');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { name: 'Southside Coaching' })).toBeVisible();

  const switcher = page.getByRole('button', {
    name: 'Switch organization, current: Southside Coaching',
  });
  await switcher.focus();
  await page.keyboard.press('Enter');
  await expect(switcher).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByRole('link', { name: 'Southside Coaching' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await page.screenshot({ path: testInfo.outputPath('switcher.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(switcher).toHaveAttribute('aria-expanded', 'false');
  await expect(switcher).toBeFocused();

  await page.keyboard.press('Enter');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Northside Strength' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: 'Northside Strength' })).toBeVisible();
  await expect(page.getByLabel('Organization name')).toHaveValue('Northside Strength');

  // Returning home resumes the organization used last.
  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Northside Strength' })).toBeVisible();

  await page.getByRole('button', { name: `Account: ${email}` }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
});

test('another account cannot open an organization it does not belong to', async ({
  page,
  playwright,
  request,
}) => {
  const owner = await signedInClient(playwright, request);
  const organization = await (
    await owner.post(`${api}/organizations`, { data: { name: 'Hidden Barbell Club' } })
  ).json();

  const outsider = await verifiedAccount(request);
  await signIn(page, outsider);
  await page.goto(`/organizations/${organization.id}`);
  await expect(page.getByRole('heading', { name: 'Organization not available' })).toBeVisible();
  await expect(page.getByText('Hidden Barbell Club')).toHaveCount(0);
  await page.getByRole('link', { name: 'Return to your account' }).click();
  await expect(page.getByRole('heading', { name: 'Your training space' })).toBeVisible();
});

test('a failed creation keeps the typed name and can be retried', async ({ page, request }) => {
  const email = await verifiedAccount(request);
  await signIn(page, email);
  await page.route('**/organizations', (route) =>
    route.request().method() === 'POST' ? route.abort('failed') : route.fallback(),
  );
  await page.getByLabel('Organization name').fill('Riverside Lifting');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('alert')).toContainText('Check your connection');
  await expect(page.getByLabel('Organization name')).toHaveValue('Riverside Lifting');
  await page.unroute('**/organizations');
  await page.getByRole('button', { name: 'Create organization' }).click();
  await expect(page.getByRole('heading', { name: 'Riverside Lifting' })).toBeVisible();
});

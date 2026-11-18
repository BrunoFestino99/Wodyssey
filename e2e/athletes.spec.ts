import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import {
  api,
  messagesFor,
  signedInAs,
  signInToOrganization,
  verifiedAccount,
  type Playwright,
} from './support';

test.afterEach(async ({ page }, testInfo) => {
  expect(
    await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('screen.png'), fullPage: true });
});

/** Invites a new verified account with these roles and accepts on their behalf. */
async function join(
  playwright: Playwright,
  setup: APIRequestContext,
  admin: APIRequestContext,
  organizationId: string,
  roles: string[],
): Promise<string> {
  const email = await verifiedAccount(setup);
  expect(
    (
      await admin.post(`${api}/organizations/${organizationId}/invitations`, {
        data: { email, roles },
      })
    ).status(),
  ).toBe(201);
  const { token } = (await messagesFor(setup, email))
    .filter((message) => message.type === 'invitation')
    .at(-1)!;
  const client = await signedInAs(playwright, email);
  expect((await client.post(`${api}/invitations/accept`, { data: { token } })).status()).toBe(200);
  return email;
}

async function signOut(page: Page, email: string) {
  await page.getByRole('button', { name: `Account: ${email}` }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
}

test('an administrator assigns responsible coaches, who see only their athletes', async ({
  page,
  playwright,
  request,
}, testInfo) => {
  const adminEmail = await verifiedAccount(request);
  const admin = await signedInAs(playwright, adminEmail);
  const organization = await (
    await admin.post(`${api}/organizations`, { data: { name: 'Harbor Strength' } })
  ).json();
  const coachA = await join(playwright, request, admin, organization.id, ['coach']);
  const early = await join(playwright, request, admin, organization.id, ['athlete']);

  await signInToOrganization(page, adminEmail, organization.name);
  const athletes = page.getByRole('region', { name: 'Athletes' });
  // The sole coach is responsible automatically, so there is nothing to configure.
  await expect(athletes.getByRole('list', { name: `Coaches of ${early}` })).toHaveText(coachA);

  const coachB = await join(playwright, request, admin, organization.id, ['coach']);
  const later = await join(playwright, request, admin, organization.id, ['athlete']);
  await page.reload();
  await expect(athletes.getByRole('list', { name: `Coaches of ${early}` })).toHaveText(coachA);
  await expect(athletes.getByText(`${later}No coach assigned`)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('unassigned.png'), fullPage: true });

  // Assigning both coaches with the keyboard.
  await athletes.getByRole('button', { name: `Assign coaches to ${later}` }).focus();
  await page.keyboard.press('Enter');
  const editor = athletes.getByRole('group', { name: `Coaches responsible for ${later}` });
  await expect(editor.getByRole('checkbox')).toHaveCount(2);
  // Coaches are listed by email.
  const [firstCoach, secondCoach] = [coachA, coachB].sort();
  await editor.getByRole('checkbox', { name: firstCoach }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('Tab');
  await expect(editor.getByRole('checkbox', { name: secondCoach })).toBeFocused();
  await page.keyboard.press('Space');
  await page.screenshot({ path: testInfo.outputPath('assigning.png'), fullPage: true });
  await page.keyboard.press('Enter');
  await expect(athletes.getByRole('status')).toHaveText(`Coaches updated for ${later}.`);
  await expect(athletes.getByRole('button', { name: `Assign coaches to ${later}` })).toBeFocused();
  await expect(athletes.getByRole('list', { name: `Coaches of ${later}` })).toHaveText(
    firstCoach + secondCoach,
  );

  // Every athlete keeps at least one responsible coach.
  await athletes.getByRole('button', { name: `Assign coaches to ${early}` }).click();
  await athletes.getByRole('checkbox', { name: coachA }).uncheck();
  await athletes.getByRole('button', { name: 'Save coaches' }).click();
  await expect(athletes.getByRole('alert')).toHaveText('Choose at least one coach.');
  // Reassigning the early athlete to the second coach.
  await athletes.getByRole('checkbox', { name: coachB }).check();
  await athletes.getByRole('button', { name: 'Save coaches' }).click();
  await expect(athletes.getByRole('list', { name: `Coaches of ${early}` })).toHaveText(coachB);
  await page.reload();
  await expect(athletes.getByRole('list', { name: `Coaches of ${early}` })).toHaveText(coachB);
  await page.screenshot({ path: testInfo.outputPath('assigned.png'), fullPage: true });

  // The first coach now follows only the later athlete.
  await signOut(page, adminEmail);
  await signInToOrganization(page, coachA, organization.name);
  await expect(athletes.getByRole('list', { name: `Coaches of ${later}` })).toBeVisible();
  await expect(athletes.getByText(early)).toHaveCount(0);
  await expect(athletes.getByRole('button', { name: /Assign coaches/ })).toHaveCount(0);
  await page.screenshot({ path: testInfo.outputPath('coach-view.png'), fullPage: true });
});

test('administrators see why athletes cannot be assigned yet, and athletes do not see the athletes section', async ({
  page,
  playwright,
  request,
}) => {
  const adminEmail = await verifiedAccount(request);
  const admin = await signedInAs(playwright, adminEmail);
  const organization = await (
    await admin.post(`${api}/organizations`, { data: { name: 'Quiet Box' } })
  ).json();

  await signInToOrganization(page, adminEmail, organization.name);
  const athletes = page.getByRole('region', { name: 'Athletes' });
  await expect(athletes.getByText('No athletes yet.')).toBeVisible();

  const athlete = await join(playwright, request, admin, organization.id, ['athlete']);
  await page.reload();
  await expect(athletes.getByText(`${athlete}No coach assigned`)).toBeVisible();
  await expect(
    athletes.getByText('Give a member the coach role to assign them athletes.'),
  ).toBeVisible();
  await expect(athletes.getByRole('button', { name: /Assign coaches/ })).toHaveCount(0);

  // Making the administrator the sole coach assigns the athlete right away.
  const members = page.getByRole('region', { name: 'Members', exact: true });
  await members.getByRole('button', { name: `Edit roles of ${adminEmail}` }).click();
  await members.getByRole('checkbox', { name: 'Coach' }).check();
  await members.getByRole('button', { name: 'Save roles' }).click();
  await expect(athletes.getByRole('list', { name: `Coaches of ${athlete}` })).toHaveText(
    adminEmail,
  );

  // A coach who stops coaching while the form is open cannot be assigned.
  const leaving = await join(playwright, request, admin, organization.id, ['coach']);
  await page.reload();
  await athletes.getByRole('button', { name: `Assign coaches to ${athlete}` }).click();
  await athletes.getByRole('checkbox', { name: leaving }).check();
  const everyone = await (
    await admin.get(`${api}/organizations/${organization.id}/members`)
  ).json();
  const { accountId } = everyone.find((member: { email: string }) => member.email === leaving);
  expect(
    (
      await admin.patch(`${api}/organizations/${organization.id}/members/${accountId}`, {
        data: { roles: ['athlete'] },
      })
    ).status(),
  ).toBe(200);
  await athletes.getByRole('button', { name: 'Save coaches' }).click();
  await expect(athletes.getByRole('alert')).toHaveText(
    'The coaches of this organization have changed. Reload the page and try again.',
  );

  await signOut(page, adminEmail);
  await signInToOrganization(page, athlete, organization.name);
  await expect(page.getByRole('heading', { name: 'Quiet Box', level: 1 })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Athletes' })).toHaveCount(0);
});

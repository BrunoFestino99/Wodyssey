import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { api, messagesFor, password, signIn, uniqueEmail, verifiedAccount } from './support';

test.afterEach(async ({ page }, testInfo) => {
  expect(
    await page.locator('body').evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath('screen.png'), fullPage: true });
});

async function invitationLink(request: APIRequestContext, email: string): Promise<string> {
  const messages = await messagesFor(request, email);
  const invitation = messages.filter((message) => message.type === 'invitation').at(-1);
  expect(invitation).toBeDefined();
  const url = new URL(invitation!.url);
  return `${url.pathname}${url.search}`;
}

/** Signs in through the web form, wherever the form sends the account afterwards. */
async function signInFromForm(page: Page, email: string) {
  await expect(page.getByLabel('Email address')).toHaveValue(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Password', { exact: true }).press('Enter');
}

async function createOrganization(page: Page, name: string) {
  await page.getByLabel('Organization name').fill(name);
  await page.getByLabel('Organization name').press('Enter');
  await expect(page.getByRole('heading', { name, level: 1 })).toBeVisible();
}

test('an administrator invites a new coach and athlete who joins after creating an account', async ({
  page,
  request,
}, testInfo) => {
  const admin = await verifiedAccount(request);
  const invitee = uniqueEmail('invitee');
  await signIn(page, admin);
  await createOrganization(page, 'Northside Training');

  const invite = page.getByRole('region', { name: 'Invite members' });
  await invite.getByLabel('Email address').fill(invitee);
  // Athlete is preselected; the keyboard toggles the coach role too.
  await expect(invite.getByRole('checkbox', { name: 'Athlete' })).toBeChecked();
  await invite.getByRole('checkbox', { name: 'Coach' }).focus();
  await page.keyboard.press('Space');
  await expect(invite.getByRole('checkbox', { name: 'Coach' })).toBeChecked();
  await invite.getByRole('button', { name: 'Send invitation' }).click();
  await expect(invite.getByRole('status').first()).toHaveText(`Invitation sent to ${invitee}.`);
  await expect(invite.getByLabel('Invitation link')).toHaveValue(/\/invitations\?token=/);
  await expect(invite.getByLabel('Email address')).toHaveValue('');
  const pending = page.getByRole('region', { name: 'Pending invitations' });
  await expect(pending.getByText(invitee)).toBeVisible();
  await expect(pending.getByRole('list', { name: `Roles of ${invitee}` })).toHaveText(
    /Coach\s*Athlete/,
  );
  await page.screenshot({ path: testInfo.outputPath('invited.png'), fullPage: true });

  // The invitee opens the emailed link in a fresh browser, without an account yet.
  const context = await page.context().browser()!.newContext({ viewport: page.viewportSize() });
  const guest = await context.newPage();
  await guest.goto(await invitationLink(request, invitee));
  await expect(guest.getByRole('heading', { name: 'Join Northside Training' })).toBeVisible();
  await expect(guest.getByRole('list', { name: 'Invited roles' })).toHaveText(/Coach\s*Athlete/);
  await expect(guest.getByText(invitee)).toBeVisible();
  await guest.screenshot({
    path: testInfo.outputPath('invitation-signed-out.png'),
    fullPage: true,
  });

  await guest.getByRole('link', { name: 'Create account' }).click();
  await expect(guest.getByLabel('Email address')).toHaveValue(invitee);
  await guest.getByLabel('Password', { exact: true }).fill(password);
  await guest.getByRole('button', { name: 'Create account' }).click();
  await expect(guest.getByRole('heading', { name: 'Check your email' })).toBeVisible();
  const verification = (await messagesFor(request, invitee)).find(
    (message) => message.type === 'verification',
  )!;
  await guest.goto(new URL(verification.url).pathname + new URL(verification.url).search);
  await guest.getByRole('button', { name: 'Verify email' }).click();
  await guest.getByRole('link', { name: 'Sign in' }).click();
  await guest.getByLabel('Email address').fill(invitee);
  await signInFromForm(guest, invitee);

  // Signing in returns to the invitation that started the journey.
  await expect(guest.getByRole('heading', { name: 'Join Northside Training' })).toBeVisible();
  await guest.screenshot({ path: testInfo.outputPath('invitation-signed-in.png'), fullPage: true });
  await guest.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(guest.getByRole('heading', { name: 'Northside Training', level: 1 })).toBeVisible();
  await expect(guest.getByRole('list', { name: 'Your roles' })).toHaveText(/Coach\s*Athlete/);
  // As a coach, the new member can invite athletes but does not manage members.
  await expect(guest.getByRole('region', { name: 'Invite athletes' })).toBeVisible();
  await expect(guest.getByRole('region', { name: 'Members', exact: true })).toHaveCount(0);
  await guest.screenshot({ path: testInfo.outputPath('joined.png'), fullPage: true });

  // Reopening the used link points back to the organization instead of offering it again.
  await guest.goBack();
  await guest.reload();
  await expect(
    guest.getByRole('heading', { name: 'You’ve joined Northside Training' }),
  ).toBeVisible();
  await guest.getByRole('link', { name: 'Open Northside Training' }).click();
  await expect(guest.getByRole('heading', { name: 'Northside Training', level: 1 })).toBeVisible();
  await context.close();

  await page.reload();
  const members = page.getByRole('region', { name: 'Members', exact: true });
  await expect(members.getByRole('list', { name: `Roles of ${invitee}` })).toHaveText(
    /Coach\s*Athlete/,
  );
  await expect(
    page.getByRole('region', { name: 'Pending invitations' }).getByText('No pending invitations.'),
  ).toBeVisible();
});

test('a coach invites and revokes athletes, and an administrator also trains as an athlete', async ({
  page,
  playwright,
  request,
}, testInfo) => {
  const admin = await playwright.request.newContext();
  const adminEmail = await verifiedAccount(request);
  await admin.post(`${api}/auth/login`, { data: { email: adminEmail, password } });
  const organization = await (
    await admin.post(`${api}/organizations`, { data: { name: 'Riverside Lifting' } })
  ).json();
  const coach = await verifiedAccount(request);
  await admin.post(`${api}/organizations/${organization.id}/invitations`, {
    data: { email: coach, roles: ['coach'] },
  });

  await page.goto(await invitationLink(request, coach));
  await page.getByRole('link', { name: 'Sign in to accept' }).click();
  await signInFromForm(page, coach);
  await page.getByRole('button', { name: 'Accept invitation' }).click();
  await expect(page.getByRole('heading', { name: 'Riverside Lifting', level: 1 })).toBeVisible();

  const invite = page.getByRole('region', { name: 'Invite athletes' });
  await expect(invite.getByText('They’ll join as an athlete.')).toBeVisible();
  await expect(invite.getByRole('checkbox')).toHaveCount(0);
  const athlete = uniqueEmail('athlete');
  await invite.getByLabel('Email address').fill(athlete);
  await invite.getByLabel('Email address').press('Enter');
  await expect(invite.getByRole('status').first()).toHaveText(`Invitation sent to ${athlete}.`);
  const pending = page.getByRole('region', { name: 'Pending invitations' });
  await expect(pending.getByRole('list', { name: `Roles of ${athlete}` })).toHaveText('Athlete');
  await expect(pending.getByText(`Invited by ${coach}`)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('coach-invited.png'), fullPage: true });

  await pending.getByRole('button', { name: `Revoke invitation for ${athlete}` }).click();
  await expect(pending.getByRole('status')).toHaveText(`Invitation for ${athlete} revoked.`);
  await expect(pending.getByText('No pending invitations.')).toBeVisible();
  await page.reload();
  await expect(pending.getByText('No pending invitations.')).toBeVisible();

  // The administrator adds the athlete role to their own membership.
  await page.getByRole('button', { name: `Account: ${coach}` }).click();
  await page.getByRole('button', { name: 'Sign out' }).click();
  // The workspace also has an email field; wait for the sign-in form before typing.
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await page.getByLabel('Email address').fill(adminEmail);
  await signInFromForm(page, adminEmail);
  // Home resumes the organization this browser used last.
  await expect(page.getByRole('heading', { name: 'Riverside Lifting', level: 1 })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Your roles' })).toHaveText('Administrator');
  const members = page.getByRole('region', { name: 'Members', exact: true });
  await expect(members.getByText(`${adminEmail} · You`)).toBeVisible();
  await members.getByRole('button', { name: `Edit roles of ${adminEmail}` }).click();
  await members.getByRole('checkbox', { name: 'Athlete' }).check();
  await page.screenshot({ path: testInfo.outputPath('edit-roles.png'), fullPage: true });
  await members.getByRole('button', { name: 'Save roles' }).click();
  await expect(members.getByRole('status')).toHaveText(`Roles updated for ${adminEmail}.`);
  await expect(members.getByRole('button', { name: `Edit roles of ${adminEmail}` })).toBeFocused();
  await expect(page.getByRole('list', { name: 'Your roles' })).toHaveText(
    /Administrator\s*Athlete/,
  );

  // A member keeps at least one role.
  await members.getByRole('button', { name: `Edit roles of ${coach}` }).click();
  await members.getByRole('checkbox', { name: 'Coach' }).uncheck();
  await members.getByRole('button', { name: 'Save roles' }).click();
  await expect(members.getByRole('alert')).toHaveText('Choose at least one role.');
  await members.getByRole('button', { name: 'Cancel' }).click();
  await expect(members.getByRole('list', { name: `Roles of ${coach}` })).toHaveText('Coach');
});

test('an invitation opened by another account or already used cannot be accepted', async ({
  page,
  playwright,
  request,
}) => {
  const admin = await playwright.request.newContext();
  const adminEmail = await verifiedAccount(request);
  await admin.post(`${api}/auth/login`, { data: { email: adminEmail, password } });
  const organization = await (
    await admin.post(`${api}/organizations`, { data: { name: 'Hidden Barbell Club' } })
  ).json();
  const invitee = await verifiedAccount(request);
  await admin.post(`${api}/organizations/${organization.id}/invitations`, {
    data: { email: invitee, roles: ['athlete'] },
  });
  const link = await invitationLink(request, invitee);

  const stranger = await verifiedAccount(request);
  await signIn(page, stranger);
  await page.goto(link);
  await expect(page.getByRole('alert')).toHaveText(
    `This invitation was sent to ${invitee}, but you’re signed in as ${stranger}. Sign in with the invited address to accept it.`,
  );
  await expect(page.getByRole('button', { name: 'Accept invitation' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('link', { name: 'Sign in to accept' })).toBeVisible();

  // An invitation left open is not offered to whoever signs in after signing out.
  await page.getByRole('link', { name: 'Sign in to accept' }).click();
  await page.getByLabel('Email address').fill(stranger);
  await signInFromForm(page, stranger);
  await expect(page.getByRole('heading', { name: 'Join Hidden Barbell Club' })).toBeVisible();
  await page.goto('/home');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await signIn(page, stranger);

  await page.goto('/invitations?token=not-a-real-invitation-token-at-all-000000000');
  await expect(page.getByRole('heading', { name: 'This invitation can’t be used' })).toBeVisible();
  await page.goto('/invitations');
  await expect(page.getByRole('heading', { name: 'This invitation can’t be used' })).toBeVisible();
});

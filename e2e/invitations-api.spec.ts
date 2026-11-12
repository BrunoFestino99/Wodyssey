import { expect, test, type APIRequestContext } from '@playwright/test';
import { api, messagesFor, password, verifiedAccount } from './support';

type Playwright = { request: { newContext(): Promise<APIRequestContext> } };

async function member(playwright: Playwright, setup: APIRequestContext) {
  const email = await verifiedAccount(setup);
  const client = await playwright.request.newContext();
  expect((await client.post(`${api}/auth/login`, { data: { email, password } })).status()).toBe(
    200,
  );
  return { email, client };
}

async function organizationOf(client: APIRequestContext, name = 'Northside Training') {
  const response = await client.post(`${api}/organizations`, { data: { name } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { id: string; name: string };
}

async function invite(
  client: APIRequestContext,
  organizationId: string,
  email: string,
  roles: string[],
) {
  return client.post(`${api}/organizations/${organizationId}/invitations`, {
    data: { email, roles },
  });
}

async function invitationToken(setup: APIRequestContext, email: string): Promise<string> {
  const messages = await messagesFor(setup, email);
  const invitation = messages.filter((message) => message.type === 'invitation').at(-1);
  expect(invitation).toBeDefined();
  return invitation!.token;
}

test('an administrator invites an athlete who joins with the intended role', async ({
  playwright,
  request,
}) => {
  const admin = await member(playwright, request);
  const athlete = await member(playwright, request);
  const organization = await organizationOf(admin.client);

  const sent = await invite(admin.client, organization.id, athlete.email.toUpperCase(), [
    'athlete',
  ]);
  expect(sent.status()).toBe(201);
  expect(await sent.json()).toEqual({
    invitation: {
      id: expect.any(String),
      email: athlete.email,
      roles: ['athlete'],
      invitedBy: admin.email,
      expiresAt: expect.any(String),
    },
    url: expect.stringContaining('/invitations?token='),
  });

  const token = await invitationToken(request, athlete.email);
  const anonymous = await playwright.request.newContext();
  const preview = await anonymous.post(`${api}/invitations/preview`, { data: { token } });
  expect(preview.status()).toBe(200);
  expect(await preview.json()).toEqual({
    status: 'pending',
    organization: { name: 'Northside Training' },
    email: athlete.email,
    roles: ['athlete'],
    expiresAt: expect.any(String),
  });

  const accepted = await athlete.client.post(`${api}/invitations/accept`, { data: { token } });
  expect(accepted.status()).toBe(200);
  expect(await accepted.json()).toEqual({
    id: organization.id,
    name: 'Northside Training',
    roles: ['athlete'],
  });
  expect(await (await athlete.client.get(`${api}/organizations`)).json()).toEqual([
    { id: organization.id, name: 'Northside Training', roles: ['athlete'] },
  ]);
  expect(
    await (await admin.client.get(`${api}/organizations/${organization.id}/members`)).json(),
  ).toEqual([
    { accountId: expect.any(String), email: admin.email, roles: ['administrator'] },
    { accountId: expect.any(String), email: athlete.email, roles: ['athlete'] },
  ]);
  expect(
    await (await admin.client.get(`${api}/organizations/${organization.id}/invitations`)).json(),
  ).toEqual([]);
});

async function join(
  playwright: Playwright,
  setup: APIRequestContext,
  inviter: APIRequestContext,
  organizationId: string,
  roles: string[],
) {
  const joined = await member(playwright, setup);
  expect((await invite(inviter, organizationId, joined.email, roles)).status()).toBe(201);
  const token = await invitationToken(setup, joined.email);
  expect(
    (await joined.client.post(`${api}/invitations/accept`, { data: { token } })).status(),
  ).toBe(200);
  return joined;
}

test('coaches invite athletes only, and only members with a role that allows it invite', async ({
  playwright,
  request,
}) => {
  const admin = await member(playwright, request);
  const { id } = await organizationOf(admin.client);
  const coach = await join(playwright, request, admin.client, id, ['coach']);
  const athlete = await join(playwright, request, admin.client, id, ['athlete']);
  const outsider = await member(playwright, request);
  const invitee = 'future-athlete@example.test';

  for (const roles of [['coach'], ['coach', 'athlete']])
    expect((await invite(coach.client, id, invitee, roles)).status()).toBe(403);
  expect((await invite(athlete.client, id, invitee, ['athlete'])).status()).toBe(403);
  expect((await invite(outsider.client, id, invitee, ['athlete'])).status()).toBe(404);
  expect((await athlete.client.get(`${api}/organizations/${id}/invitations`)).status()).toBe(403);
  expect((await coach.client.get(`${api}/organizations/${id}/members`)).status()).toBe(403);

  const byCoach = await invite(coach.client, id, invitee, ['athlete']);
  expect(byCoach.status()).toBe(201);
  const coachInvitation = (await byCoach.json()).invitation;
  const byAdmin = (
    await (await invite(admin.client, id, 'new-coach@example.test', ['coach'])).json()
  ).invitation;

  // Coaches follow up on their own invitations; administrators see all of them.
  expect(await (await coach.client.get(`${api}/organizations/${id}/invitations`)).json()).toEqual([
    coachInvitation,
  ]);
  expect(await (await admin.client.get(`${api}/organizations/${id}/invitations`)).json()).toEqual([
    coachInvitation,
    byAdmin,
  ]);
  expect(
    (await coach.client.delete(`${api}/organizations/${id}/invitations/${byAdmin.id}`)).status(),
  ).toBe(404);
  expect(
    (
      await athlete.client.delete(`${api}/organizations/${id}/invitations/${coachInvitation.id}`)
    ).status(),
  ).toBe(403);
  expect(
    (
      await coach.client.delete(`${api}/organizations/${id}/invitations/${coachInvitation.id}`)
    ).status(),
  ).toBe(204);
  expect(
    (await admin.client.delete(`${api}/organizations/${id}/invitations/${byAdmin.id}`)).status(),
  ).toBe(204);
  expect(await (await admin.client.get(`${api}/organizations/${id}/invitations`)).json()).toEqual(
    [],
  );
});

test('one account can be coach and athlete in an organization and belong to several', async ({
  playwright,
  request,
}) => {
  const admin = await member(playwright, request);
  const north = await organizationOf(admin.client, 'Northside Training');
  const coach = await join(playwright, request, admin.client, north.id, ['coach']);

  expect((await invite(admin.client, north.id, coach.email, ['coach'])).status()).toBe(409);
  expect((await invite(admin.client, north.id, coach.email, ['athlete'])).status()).toBe(201);
  const token = await invitationToken(request, coach.email);
  expect(
    await (await coach.client.post(`${api}/invitations/accept`, { data: { token } })).json(),
  ).toEqual({ id: north.id, name: 'Northside Training', roles: ['athlete', 'coach'] });

  const otherAdmin = await member(playwright, request);
  const south = await organizationOf(otherAdmin.client, 'Southside Coaching');
  expect((await invite(otherAdmin.client, south.id, coach.email, ['athlete'])).status()).toBe(201);
  const southToken = await invitationToken(request, coach.email);
  expect(
    (
      await coach.client.post(`${api}/invitations/accept`, { data: { token: southToken } })
    ).status(),
  ).toBe(200);
  expect(await (await coach.client.get(`${api}/organizations`)).json()).toEqual([
    { id: north.id, name: 'Northside Training', roles: ['athlete', 'coach'] },
    { id: south.id, name: 'Southside Coaching', roles: ['athlete'] },
  ]);
  // Each organization only lists its own members.
  expect(
    (await (await otherAdmin.client.get(`${api}/organizations/${south.id}/members`)).json()).map(
      (entry: { email: string }) => entry.email,
    ),
  ).toEqual([otherAdmin.email, coach.email]);
});

test('invalid, reused, revoked or misaddressed invitations grant nothing', async ({
  playwright,
  request,
}) => {
  const admin = await member(playwright, request);
  const { id } = await organizationOf(admin.client);
  const invitee = await member(playwright, request);
  const stranger = await member(playwright, request);
  const anonymous = await playwright.request.newContext();

  expect((await invite(admin.client, id, invitee.email, ['coach'])).status()).toBe(201);
  const token = await invitationToken(request, invitee.email);

  // Someone holding a forwarded link cannot use it with another account.
  expect(
    (await stranger.client.post(`${api}/invitations/accept`, { data: { token } })).status(),
  ).toBe(403);
  expect((await anonymous.post(`${api}/invitations/accept`, { data: { token } })).status()).toBe(
    401,
  );
  expect(
    (
      await invitee.client.post(`${api}/invitations/accept`, { data: { token: 'x'.repeat(43) } })
    ).status(),
  ).toBe(404);
  for (const data of [{ token: 'short' }, {}])
    expect((await invitee.client.post(`${api}/invitations/accept`, { data })).status()).toBe(400);
  expect(
    (
      await anonymous.post(`${api}/invitations/preview`, { data: { token: 'y'.repeat(43) } })
    ).status(),
  ).toBe(404);

  expect(
    (await invitee.client.post(`${api}/invitations/accept`, { data: { token } })).status(),
  ).toBe(200);
  // Accepting again from the same account is harmless; anyone else is refused.
  expect(
    await (await invitee.client.post(`${api}/invitations/accept`, { data: { token } })).json(),
  ).toEqual({ id, name: 'Northside Training', roles: ['coach'] });
  expect(
    (await stranger.client.post(`${api}/invitations/accept`, { data: { token } })).status(),
  ).toBe(404);
  expect((await anonymous.post(`${api}/invitations/preview`, { data: { token } })).status()).toBe(
    404,
  );

  const revoked = (await (await invite(admin.client, id, stranger.email, ['athlete'])).json())
    .invitation;
  const revokedToken = await invitationToken(request, stranger.email);
  expect(
    (await admin.client.delete(`${api}/organizations/${id}/invitations/${revoked.id}`)).status(),
  ).toBe(204);
  expect(
    (await admin.client.delete(`${api}/organizations/${id}/invitations/${revoked.id}`)).status(),
  ).toBe(404);
  expect(
    (
      await stranger.client.post(`${api}/invitations/accept`, { data: { token: revokedToken } })
    ).status(),
  ).toBe(404);
  expect(await (await stranger.client.get(`${api}/organizations`)).json()).toEqual([]);
  expect(
    (await (await admin.client.get(`${api}/organizations/${id}/members`)).json()).map(
      (entry: { email: string; roles: string[] }) => [entry.email, entry.roles],
    ),
  ).toEqual([
    [admin.email, ['administrator']],
    [invitee.email, ['coach']],
  ]);
});

test('simultaneous acceptances of one invitation create a single membership', async ({
  playwright,
  request,
}) => {
  const admin = await member(playwright, request);
  const { id } = await organizationOf(admin.client);
  const invitee = await member(playwright, request);
  await invite(admin.client, id, invitee.email, ['coach', 'athlete']);
  const token = await invitationToken(request, invitee.email);

  const responses = await Promise.all(
    [1, 2, 3, 4].map(() => invitee.client.post(`${api}/invitations/accept`, { data: { token } })),
  );
  expect(responses.map((response) => response.status())).toEqual([200, 200, 200, 200]);
  expect(await (await admin.client.get(`${api}/organizations/${id}/members`)).json()).toEqual([
    { accountId: expect.any(String), email: admin.email, roles: ['administrator'] },
    { accountId: expect.any(String), email: invitee.email, roles: ['athlete', 'coach'] },
  ]);
});

test('administrators set the coach and athlete roles of members, including their own', async ({
  playwright,
  request,
}) => {
  const admin = await member(playwright, request);
  const { id } = await organizationOf(admin.client);
  const coach = await join(playwright, request, admin.client, id, ['coach']);
  const [self, coachMember] = await (
    await admin.client.get(`${api}/organizations/${id}/members`)
  ).json();
  const setRoles = (client: APIRequestContext, accountId: string, roles: unknown) =>
    client.patch(`${api}/organizations/${id}/members/${accountId}`, { data: { roles } });

  const promoted = await setRoles(admin.client, self.accountId, ['coach', 'athlete']);
  expect(promoted.status()).toBe(200);
  expect(await promoted.json()).toEqual({
    accountId: self.accountId,
    email: admin.email,
    roles: ['administrator', 'athlete', 'coach'],
  });
  // The administrator role is never removed here.
  expect(await (await setRoles(admin.client, self.accountId, [])).json()).toMatchObject({
    roles: ['administrator'],
  });

  expect(await (await setRoles(admin.client, coachMember.accountId, ['athlete'])).json()).toEqual({
    accountId: coachMember.accountId,
    email: coach.email,
    roles: ['athlete'],
  });
  expect(await (await coach.client.get(`${api}/organizations/${id}`)).json()).toMatchObject({
    roles: ['athlete'],
  });
  // A former coach can no longer invite.
  expect((await invite(coach.client, id, 'someone@example.test', ['athlete'])).status()).toBe(403);
  expect((await setRoles(admin.client, coachMember.accountId, [])).status()).toBe(400);
  for (const roles of [['administrator'], ['coach', 'coach'], ['owner'], 'coach'])
    expect((await setRoles(admin.client, coachMember.accountId, roles)).status()).toBe(400);
  expect((await setRoles(coach.client, self.accountId, ['athlete'])).status()).toBe(403);
  expect((await setRoles(coach.client, coachMember.accountId, ['coach'])).status()).toBe(403);
  expect((await setRoles(admin.client, 'not-a-member', ['coach'])).status()).toBe(404);
  const outsider = await member(playwright, request);
  expect((await setRoles(outsider.client, coachMember.accountId, ['coach'])).status()).toBe(404);
  expect(await (await coach.client.get(`${api}/organizations/${id}`)).json()).toMatchObject({
    roles: ['athlete'],
  });
});

test('invitation requests are validated', async ({ playwright, request }) => {
  const admin = await member(playwright, request);
  const { id } = await organizationOf(admin.client);
  for (const data of [
    { email: 'not-an-email', roles: ['athlete'] },
    { email: 'a@example.test', roles: [] },
    { email: 'a@example.test', roles: ['administrator'] },
    { email: 'a@example.test', roles: ['athlete', 'athlete'] },
    { email: 'a@example.test' },
    { email: 'a@example.test', roles: ['athlete'], extra: true },
  ])
    expect(
      (await admin.client.post(`${api}/organizations/${id}/invitations`, { data })).status(),
    ).toBe(400);
  expect(
    (
      await admin.client.post(`${api}/organizations/${id}/invitations`, {
        headers: { origin: 'https://untrusted.example' },
        data: { email: 'a@example.test', roles: ['athlete'] },
      })
    ).status(),
  ).toBe(403);
  const anonymous = await playwright.request.newContext();
  expect(
    (
      await anonymous.post(`${api}/organizations/${id}/invitations`, {
        data: { email: 'a@example.test', roles: ['athlete'] },
      })
    ).status(),
  ).toBe(401);
});

test('removing the coach role withdraws the athlete invitations that coach sent', async ({
  playwright,
  request,
}) => {
  const admin = await member(playwright, request);
  const { id } = await organizationOf(admin.client);
  const coach = await join(playwright, request, admin.client, id, ['coach']);
  const athlete = await member(playwright, request);
  expect((await invite(coach.client, id, athlete.email, ['athlete'])).status()).toBe(201);
  const token = await invitationToken(request, athlete.email);

  const coachMember = (
    await (await admin.client.get(`${api}/organizations/${id}/members`)).json()
  ).find((entry: { email: string }) => entry.email === coach.email);
  await admin.client.patch(`${api}/organizations/${id}/members/${coachMember.accountId}`, {
    data: { roles: ['athlete'] },
  });

  expect(
    (await athlete.client.post(`${api}/invitations/preview`, { data: { token } })).status(),
  ).toBe(404);
  expect(
    (await athlete.client.post(`${api}/invitations/accept`, { data: { token } })).status(),
  ).toBe(404);
  expect(await (await admin.client.get(`${api}/organizations/${id}/invitations`)).json()).toEqual(
    [],
  );
  expect(await (await athlete.client.get(`${api}/organizations`)).json()).toEqual([]);
});

test('resending replaces the earlier link, and joining clears invitations that add nothing', async ({
  playwright,
  request,
}) => {
  const admin = await member(playwright, request);
  const { id } = await organizationOf(admin.client);
  const coach = await join(playwright, request, admin.client, id, ['coach']);
  const invitee = await member(playwright, request);

  await invite(admin.client, id, invitee.email, ['athlete']);
  const first = await invitationToken(request, invitee.email);
  await invite(admin.client, id, invitee.email, ['athlete']);
  const second = await invitationToken(request, invitee.email);
  expect(second).not.toBe(first);
  expect(
    (await invitee.client.post(`${api}/invitations/accept`, { data: { token: first } })).status(),
  ).toBe(404);
  // A coach's invitation with the same roles and an administrator's with more roles coexist.
  await invite(coach.client, id, invitee.email, ['athlete']);
  await invite(admin.client, id, invitee.email, ['athlete', 'coach']);
  expect(
    (await (await admin.client.get(`${api}/organizations/${id}/invitations`)).json()).map(
      (entry: { roles: string[] }) => entry.roles,
    ),
  ).toEqual([['athlete'], ['athlete'], ['athlete', 'coach']]);

  const latest = await invitationToken(request, invitee.email);
  expect(
    await (
      await invitee.client.post(`${api}/invitations/accept`, { data: { token: latest } })
    ).json(),
  ).toMatchObject({ roles: ['athlete', 'coach'] });
  expect(await (await admin.client.get(`${api}/organizations/${id}/invitations`)).json()).toEqual(
    [],
  );
});

test('the account that accepted an invitation is told where it joined', async ({
  playwright,
  request,
}) => {
  const admin = await member(playwright, request);
  const organization = await organizationOf(admin.client, 'Southside Coaching');
  const invitee = await member(playwright, request);
  await invite(admin.client, organization.id, invitee.email, ['athlete']);
  const token = await invitationToken(request, invitee.email);
  await invitee.client.post(`${api}/invitations/accept`, { data: { token } });

  const preview = await invitee.client.post(`${api}/invitations/preview`, { data: { token } });
  expect(preview.status()).toBe(200);
  expect(await preview.json()).toEqual({
    status: 'joined',
    organization: { id: organization.id, name: 'Southside Coaching' },
  });
  const anonymous = await playwright.request.newContext();
  expect((await anonymous.post(`${api}/invitations/preview`, { data: { token } })).status()).toBe(
    404,
  );
  expect(
    (await admin.client.post(`${api}/invitations/preview`, { data: { token } })).status(),
  ).toBe(404);
});

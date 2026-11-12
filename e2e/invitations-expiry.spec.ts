import { expect, test } from '@playwright/test';
import { api, messagesFor, password, verifiedAccount } from './support';

const testInvitationLifetimeMs = Number(process.env.TEST_INVITATION_LIFETIME_MS ?? 3000);

test('an expired invitation cannot be previewed or accepted', async ({ playwright, request }) => {
  const admin = await playwright.request.newContext();
  const adminEmail = await verifiedAccount(request);
  await admin.post(`${api}/auth/login`, { data: { email: adminEmail, password } });
  const { id } = await (
    await admin.post(`${api}/organizations`, { data: { name: 'Expiring Box' } })
  ).json();
  const inviteeEmail = await verifiedAccount(request);
  const invitee = await playwright.request.newContext();
  await invitee.post(`${api}/auth/login`, { data: { email: inviteeEmail, password } });
  expect(
    (
      await admin.post(`${api}/organizations/${id}/invitations`, {
        data: { email: inviteeEmail, roles: ['athlete'] },
      })
    ).status(),
  ).toBe(201);
  const { token } = (await messagesFor(request, inviteeEmail)).find(
    (message) => message.type === 'invitation',
  )!;
  expect((await invitee.post(`${api}/invitations/preview`, { data: { token } })).status()).toBe(
    200,
  );

  await new Promise((resolve) => setTimeout(resolve, testInvitationLifetimeMs + 300));
  expect((await invitee.post(`${api}/invitations/preview`, { data: { token } })).status()).toBe(
    404,
  );
  expect((await invitee.post(`${api}/invitations/accept`, { data: { token } })).status()).toBe(404);
  expect(await (await invitee.get(`${api}/organizations`)).json()).toEqual([]);
  expect(await (await admin.get(`${api}/organizations/${id}/invitations`)).json()).toEqual([]);
});

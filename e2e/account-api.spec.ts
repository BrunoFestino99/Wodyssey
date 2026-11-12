import { expect, test } from '@playwright/test';
import { api, messagesFor, password, uniqueEmail, verifiedAccount } from './support';

test('concurrent link requests and redemptions allow only one account action', async ({
  request,
}) => {
  const email = uniqueEmail('concurrent');
  const registrations = await Promise.all([
    request.post(`${api}/auth/register`, { data: { email, password } }),
    request.post(`${api}/auth/register`, { data: { email, password } }),
  ]);
  expect(registrations.map((response) => response.status())).toEqual([202, 202]);
  const verification = await messagesFor(request, email);
  expect(verification).toHaveLength(2);
  const results = await Promise.all(
    verification.map(({ token }) =>
      request.post(`${api}/auth/verification/consume`, { data: { token } }),
    ),
  );
  expect(results.map((response) => response.status()).sort()).toEqual([200, 400]);

  const recoveries = await Promise.all([
    request.post(`${api}/auth/password/forgot`, { data: { email } }),
    request.post(`${api}/auth/password/forgot`, { data: { email } }),
  ]);
  expect(recoveries.map((response) => response.status())).toEqual([202, 202]);
  const resets = (await messagesFor(request, email)).filter((message) => message.type === 'reset');
  expect(resets).toHaveLength(2);
  const resetResults = await Promise.all(
    resets.map(({ token }) =>
      request.post(`${api}/auth/password/reset`, {
        data: { token, password: 'Replacement-password-51!' },
      }),
    ),
  );
  expect(resetResults.map((response) => response.status()).sort()).toEqual([200, 400]);
});

test('invalid credentials, malformed sessions and untrusted browser origins are rejected', async ({
  request,
}) => {
  expect(
    (
      await request.post(`${api}/auth/register`, {
        data: { email: 'not-an-email', password },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await request.get(`${api}/auth/me`, {
        headers: { cookie: 'wodyssey_session=j:%7B%22invalid%22%3Atrue%7D' },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await request.post(`${api}/auth/register`, {
        headers: { origin: 'https://untrusted.example' },
        data: { email: uniqueEmail('origin'), password },
      })
    ).status(),
  ).toBe(403);
});

test('password reset revokes all sessions including a simultaneous old-password login', async ({
  request,
}) => {
  const email = await verifiedAccount(request);
  const sessionCookies: string[] = [];
  for (let index = 0; index < 2; index++) {
    const response = await request.post(`${api}/auth/login`, { data: { email, password } });
    expect(response.status()).toBe(200);
    sessionCookies.push(response.headers()['set-cookie'].split(';')[0]);
  }
  await request.post(`${api}/auth/password/forgot`, { data: { email } });
  const reset = (await messagesFor(request, email)).find((message) => message.type === 'reset')!;
  const [login, resetResponse] = await Promise.all([
    request.post(`${api}/auth/login`, { data: { email, password } }),
    request.post(`${api}/auth/password/reset`, {
      data: { token: reset.token, password: 'Replacement-password-51!' },
    }),
  ]);
  expect(resetResponse.status()).toBe(200);
  expect([200, 401]).toContain(login.status());
  if (login.status() === 200) sessionCookies.push(login.headers()['set-cookie'].split(';')[0]);
  for (const cookie of sessionCookies) {
    expect((await request.get(`${api}/auth/me`, { headers: { cookie } })).status()).toBe(401);
  }
  expect(
    (
      await request.post(`${api}/auth/login`, {
        data: { email, password: 'Replacement-password-51!' },
      })
    ).status(),
  ).toBe(200);
});

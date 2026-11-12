import { expect, test } from '@playwright/test';
import { api, signedInClient } from './support';

test('the creator administers a new organization without manual approval', async ({
  playwright,
  request,
}) => {
  const owner = await signedInClient(playwright, request);
  const created = await owner.post(`${api}/organizations`, {
    data: { name: '  Northside Training  ' },
  });
  expect(created.status()).toBe(201);
  const organization = await created.json();
  expect(organization).toEqual({
    id: expect.any(String),
    name: 'Northside Training',
    roles: ['administrator'],
  });

  const fetched = await owner.get(`${api}/organizations/${organization.id}`);
  expect(fetched.status()).toBe(200);
  expect(await fetched.json()).toEqual(organization);
  expect(await (await owner.get(`${api}/organizations`)).json()).toEqual([organization]);
});

test('outsiders cannot read, rename or discover an organization', async ({
  playwright,
  request,
}) => {
  const owner = await signedInClient(playwright, request);
  const outsider = await signedInClient(playwright, request);
  const organization = await (
    await owner.post(`${api}/organizations`, { data: { name: 'Private Box' } })
  ).json();

  expect((await outsider.get(`${api}/organizations/${organization.id}`)).status()).toBe(404);
  expect(
    (
      await outsider.patch(`${api}/organizations/${organization.id}`, {
        data: { name: 'Taken over' },
      })
    ).status(),
  ).toBe(404);
  expect(await (await outsider.get(`${api}/organizations`)).json()).toEqual([]);
  // A manipulated identifier is indistinguishable from someone else's organization.
  expect((await outsider.get(`${api}/organizations/not-a-real-id`)).status()).toBe(404);
  expect(
    (await outsider.get(`${api}/organizations/00000000-0000-4000-8000-000000000000`)).status(),
  ).toBe(404);

  expect(await (await owner.get(`${api}/organizations/${organization.id}`)).json()).toMatchObject({
    name: 'Private Box',
  });

  const anonymous = await playwright.request.newContext();
  expect((await anonymous.get(`${api}/organizations`)).status()).toBe(401);
  expect((await anonymous.post(`${api}/organizations`, { data: { name: 'X' } })).status()).toBe(
    401,
  );
  expect((await anonymous.get(`${api}/organizations/${organization.id}`)).status()).toBe(401);
  expect(
    (
      await anonymous.patch(`${api}/organizations/${organization.id}`, {
        data: { name: 'Taken over' },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await owner.post(`${api}/organizations`, {
        headers: { origin: 'https://untrusted.example' },
        data: { name: 'Cross-site' },
      })
    ).status(),
  ).toBe(403);
});

test('an administrator renames an organization with validated names', async ({
  playwright,
  request,
}) => {
  const owner = await signedInClient(playwright, request);
  const { id } = await (
    await owner.post(`${api}/organizations`, { data: { name: 'Old Name' } })
  ).json();

  for (const data of [{ name: '   ' }, { name: 'x'.repeat(81) }, { name: 42 }, {}]) {
    expect((await owner.post(`${api}/organizations`, { data })).status()).toBe(400);
    expect((await owner.patch(`${api}/organizations/${id}`, { data })).status()).toBe(400);
  }
  expect(
    (await owner.post(`${api}/organizations`, { data: { name: 'Box', roles: ['x'] } })).status(),
  ).toBe(400);

  const renamed = await owner.patch(`${api}/organizations/${id}`, {
    data: { name: ' Northside Strength ' },
  });
  expect(renamed.status()).toBe(200);
  expect(await renamed.json()).toEqual({
    id,
    name: 'Northside Strength',
    roles: ['administrator'],
  });
  expect(await (await owner.get(`${api}/organizations`)).json()).toEqual([
    { id, name: 'Northside Strength', roles: ['administrator'] },
  ]);
});

test('one account administers several organizations with separate identities', async ({
  playwright,
  request,
}) => {
  const owner = await signedInClient(playwright, request);
  // Simultaneous creations with the same name stay distinct organizations.
  const responses = await Promise.all(
    [1, 2, 3].map(() => owner.post(`${api}/organizations`, { data: { name: 'Same Name' } })),
  );
  expect(responses.map((response) => response.status())).toEqual([201, 201, 201]);
  const created = await Promise.all(responses.map((response) => response.json()));
  expect(new Set(created.map((organization) => organization.id)).size).toBe(3);

  await owner.patch(`${api}/organizations/${created[0].id}`, { data: { name: 'Renamed' } });
  const listed = await (await owner.get(`${api}/organizations`)).json();
  expect(listed).toHaveLength(3);
  expect(listed).toEqual(
    expect.arrayContaining([
      { id: created[0].id, name: 'Renamed', roles: ['administrator'] },
      { id: created[1].id, name: 'Same Name', roles: ['administrator'] },
      { id: created[2].id, name: 'Same Name', roles: ['administrator'] },
    ]),
  );
});

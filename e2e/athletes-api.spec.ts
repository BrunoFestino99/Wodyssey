import { expect, test, type APIRequestContext } from '@playwright/test';
import { api, messagesFor, signedInAs, verifiedAccount, type Playwright } from './support';

type Person = { email: string; client: APIRequestContext; accountId: string };
type Organization = { id: string; admin: Person };

async function organization(playwright: Playwright, setup: APIRequestContext) {
  const email = await verifiedAccount(setup);
  const client = await signedInAs(playwright, email);
  const response = await client.post(`${api}/organizations`, { data: { name: 'Northside' } });
  expect(response.status()).toBe(201);
  const { id } = await response.json();
  const [self] = await (await client.get(`${api}/organizations/${id}/members`)).json();
  return { id, admin: { email, client, accountId: self.accountId } } as Organization;
}

/** A signed-in person invited to the organization with these roles; `accept` joins it. */
async function invited(
  playwright: Playwright,
  setup: APIRequestContext,
  org: Organization,
  roles: string[],
) {
  const email = await verifiedAccount(setup);
  const sent = await org.admin.client.post(`${api}/organizations/${org.id}/invitations`, {
    data: { email, roles },
  });
  expect(sent.status()).toBe(201);
  const token = (await messagesFor(setup, email))
    .filter((m) => m.type === 'invitation')
    .at(-1)!.token;
  const client = await signedInAs(playwright, email);
  return {
    accept: async (): Promise<Person> => {
      expect((await client.post(`${api}/invitations/accept`, { data: { token } })).status()).toBe(
        200,
      );
      const members = await (
        await org.admin.client.get(`${api}/organizations/${org.id}/members`)
      ).json();
      const { accountId } = members.find((member: { email: string }) => member.email === email);
      return { email, client, accountId };
    },
  };
}

/** Someone who accepted an invitation to the organization with these roles. */
async function join(
  playwright: Playwright,
  setup: APIRequestContext,
  org: Organization,
  roles: string[],
): Promise<Person> {
  return (await invited(playwright, setup, org, roles)).accept();
}

const athletesOf = async (client: APIRequestContext, org: Organization) => {
  const response = await client.get(`${api}/organizations/${org.id}/athletes`);
  expect(response.status()).toBe(200);
  return response.json();
};

const assign = (
  client: APIRequestContext,
  org: Organization,
  athleteId: string,
  coaches: unknown,
) => client.patch(`${api}/organizations/${org.id}/athletes/${athleteId}`, { data: { coaches } });

type ResponsibleCoach = { accountId: string; email: string };

const coach = (person: Person): ResponsibleCoach => ({
  accountId: person.accountId,
  email: person.email,
});

test('an administrator assigns several coaches to an athlete and reassigns them', async ({
  playwright,
  request,
}) => {
  const org = await organization(playwright, request);
  const first = await join(playwright, request, org, ['coach']);
  const second = await join(playwright, request, org, ['coach']);
  const athlete = await join(playwright, request, org, ['athlete']);

  // With several coaches nobody is responsible until the administrator decides.
  expect(await athletesOf(org.admin.client, org)).toEqual([
    { accountId: athlete.accountId, email: athlete.email, coaches: [] },
  ]);

  const assigned = await assign(org.admin.client, org, athlete.accountId, [
    second.accountId,
    first.accountId,
  ]);
  expect(assigned.status()).toBe(200);
  const both = [coach(first), coach(second)].sort((a, b) => a.email.localeCompare(b.email));
  expect(await assigned.json()).toEqual({
    accountId: athlete.accountId,
    email: athlete.email,
    coaches: both,
  });
  expect(await athletesOf(org.admin.client, org)).toEqual([
    { accountId: athlete.accountId, email: athlete.email, coaches: both },
  ]);

  const reassigned = await assign(org.admin.client, org, athlete.accountId, [second.accountId]);
  expect(reassigned.status()).toBe(200);
  expect(await athletesOf(org.admin.client, org)).toEqual([
    { accountId: athlete.accountId, email: athlete.email, coaches: [coach(second)] },
  ]);
});

test('a sole coach becomes responsible for every athlete automatically', async ({
  playwright,
  request,
}) => {
  const org = await organization(playwright, request);
  // Athletes who joined before any coach are picked up once the first coach arrives.
  const early = await join(playwright, request, org, ['athlete']);
  const only = await join(playwright, request, org, ['coach']);
  const late = await join(playwright, request, org, ['athlete']);
  // An administrator who also trains is among the sole coach's athletes too.
  const promoted = await org.admin.client.patch(
    `${api}/organizations/${org.id}/members/${org.admin.accountId}`,
    { data: { roles: ['athlete'] } },
  );
  expect(promoted.status()).toBe(200);

  expect(await athletesOf(org.admin.client, org)).toEqual([
    { accountId: org.admin.accountId, email: org.admin.email, coaches: [coach(only)] },
    { accountId: early.accountId, email: early.email, coaches: [coach(only)] },
    { accountId: late.accountId, email: late.email, coaches: [coach(only)] },
  ]);

  // A second coach leaves existing responsibilities alone; new athletes wait for a decision.
  const second = await join(playwright, request, org, ['coach']);
  const unassigned = await join(playwright, request, org, ['athlete']);
  const listed = await athletesOf(org.admin.client, org);
  expect(listed.find((a: { email: string }) => a.email === late.email).coaches).toEqual([
    coach(only),
  ]);
  expect(listed.find((a: { email: string }) => a.email === unassigned.email).coaches).toEqual([]);

  // Back to one coach, every athlete again has that coach.
  expect(
    (
      await org.admin.client.patch(`${api}/organizations/${org.id}/members/${only.accountId}`, {
        data: { roles: ['athlete'] },
      })
    ).status(),
  ).toBe(200);
  const remaining = await athletesOf(org.admin.client, org);
  expect(remaining.map((a: { email: string }) => a.email).sort()).toEqual(
    [org.admin.email, early.email, late.email, unassigned.email, only.email].sort(),
  );
  for (const athlete of remaining) expect(athlete.coaches).toEqual([coach(second)]);
});

test('coaches see only their athletes and nobody but administrators assigns coaches', async ({
  playwright,
  request,
}) => {
  const org = await organization(playwright, request);
  const mine = await join(playwright, request, org, ['coach']);
  const other = await join(playwright, request, org, ['coach']);
  const followed = await join(playwright, request, org, ['athlete']);
  const notFollowed = await join(playwright, request, org, ['athlete']);
  await assign(org.admin.client, org, followed.accountId, [mine.accountId]);
  await assign(org.admin.client, org, notFollowed.accountId, [other.accountId]);

  expect(await athletesOf(mine.client, org)).toEqual([
    { accountId: followed.accountId, email: followed.email, coaches: [coach(mine)] },
  ]);
  expect(await athletesOf(other.client, org)).toEqual([
    { accountId: notFollowed.accountId, email: notFollowed.email, coaches: [coach(other)] },
  ]);
  // Athletes do not browse other athletes.
  expect((await followed.client.get(`${api}/organizations/${org.id}/athletes`)).status()).toBe(403);

  // Coaches cannot take over an athlete or change their own responsibilities.
  for (const client of [mine.client, followed.client])
    expect((await assign(client, org, notFollowed.accountId, [mine.accountId])).status()).toBe(403);

  // Someone from another organization learns nothing about this one.
  const elsewhere = await organization(playwright, request);
  const outsiderCoach = await join(playwright, request, elsewhere, ['coach']);
  const outsiderAthlete = await join(playwright, request, elsewhere, ['athlete']);
  expect(
    (await elsewhere.admin.client.get(`${api}/organizations/${org.id}/athletes`)).status(),
  ).toBe(404);
  expect(
    (
      await assign(elsewhere.admin.client, org, followed.accountId, [outsiderCoach.accountId])
    ).status(),
  ).toBe(404);

  // Manipulated identifiers inside the organization are rejected.
  const unknown = '00000000-0000-4000-8000-000000000000';
  for (const athleteId of [outsiderAthlete.accountId, mine.accountId, unknown, 'not-an-id'])
    expect((await assign(org.admin.client, org, athleteId, [mine.accountId])).status()).toBe(404);
  for (const coaches of [
    [outsiderCoach.accountId],
    [followed.accountId],
    [unknown],
    ['not-an-id'],
    [],
    [mine.accountId, mine.accountId],
    'x',
    undefined,
  ])
    expect((await assign(org.admin.client, org, followed.accountId, coaches)).status()).toBe(400);
  // A coach of another organization cannot be assigned here through their own one either.
  expect(
    (
      await assign(elsewhere.admin.client, elsewhere, outsiderAthlete.accountId, [mine.accountId])
    ).status(),
  ).toBe(400);

  expect(await athletesOf(org.admin.client, org)).toEqual([
    { accountId: followed.accountId, email: followed.email, coaches: [coach(mine)] },
    { accountId: notFollowed.accountId, email: notFollowed.email, coaches: [coach(other)] },
  ]);

  const anonymous = await playwright.request.newContext();
  expect((await anonymous.get(`${api}/organizations/${org.id}/athletes`)).status()).toBe(401);
  expect((await assign(anonymous, org, followed.accountId, [mine.accountId])).status()).toBe(401);
});

test('losing the coach or athlete role ends the responsibility', async ({
  playwright,
  request,
}) => {
  const org = await organization(playwright, request);
  const first = await join(playwright, request, org, ['coach']);
  const second = await join(playwright, request, org, ['coach', 'athlete']);
  const athlete = await join(playwright, request, org, ['athlete']);
  await assign(org.admin.client, org, athlete.accountId, [first.accountId, second.accountId]);
  await assign(org.admin.client, org, second.accountId, [first.accountId]);

  const setRoles = (person: Person, roles: string[]) =>
    org.admin.client.patch(`${api}/organizations/${org.id}/members/${person.accountId}`, {
      data: { roles },
    });
  // Dropping the athlete role of the second coach leaves them coaching.
  expect((await setRoles(second, ['coach'])).status()).toBe(200);
  expect(await athletesOf(org.admin.client, org)).toEqual([
    {
      accountId: athlete.accountId,
      email: athlete.email,
      coaches: [coach(first), coach(second)].sort((a, b) => a.email.localeCompare(b.email)),
    },
  ]);
  // Dropping the first coach's role leaves the second as the sole coach.
  expect((await setRoles(first, ['athlete'])).status()).toBe(200);
  expect(await athletesOf(second.client, org)).toEqual([
    { accountId: first.accountId, email: first.email, coaches: [coach(second)] },
    { accountId: athlete.accountId, email: athlete.email, coaches: [coach(second)] },
  ]);
  expect((await first.client.get(`${api}/organizations/${org.id}/athletes`)).status()).toBe(403);
});

test('coaches added at the same time are never both assigned automatically', async ({
  playwright,
  request,
}) => {
  for (let round = 0; round < 3; round++) {
    const org = await organization(playwright, request);
    for (let i = 0; i < 3; i++) await join(playwright, request, org, ['athlete']);
    const candidates = [
      await invited(playwright, request, org, ['coach']),
      await invited(playwright, request, org, ['coach']),
    ];
    // The organization's first two coaches join simultaneously.
    await Promise.all(candidates.map((candidate) => candidate.accept()));
    // Whoever was first was briefly the sole coach; the other never was.
    const athletes: { coaches: ResponsibleCoach[] }[] = await athletesOf(org.admin.client, org);
    expect(athletes).toHaveLength(3);
    const assigned = new Set(athletes.flatMap((athlete) => athlete.coaches.map((c) => c.email)));
    expect(assigned.size).toBe(1);
    for (const athlete of athletes) expect(athlete.coaches).toHaveLength(1);
  }
});

test('simultaneous reassignments leave one complete decision', async ({ playwright, request }) => {
  const org = await organization(playwright, request);
  const coaches = [];
  for (let i = 0; i < 4; i++) coaches.push(await join(playwright, request, org, ['coach']));
  const athlete = await join(playwright, request, org, ['athlete']);
  const choices = [
    [coaches[0].accountId, coaches[1].accountId],
    [coaches[2].accountId, coaches[3].accountId],
  ];
  for (let round = 0; round < 5; round++) {
    const responses = await Promise.all(
      choices.map((choice) => assign(org.admin.client, org, athlete.accountId, choice)),
    );
    expect(responses.map((response) => response.status())).toEqual([200, 200]);
    const [listed] = await athletesOf(org.admin.client, org);
    const chosen = listed.coaches.map((coach: { accountId: string }) => coach.accountId).sort();
    expect(choices.map((choice) => [...choice].sort())).toContainEqual(chosen);
  }
});

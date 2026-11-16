# Wodyssey

The web app provides account registration, email verification, sign in, sign out, and password recovery. Signed-in accounts create organizations, administer them, and switch between them. Administrators invite coaches and athletes, set the coach and athlete roles of members, and assign the coaches responsible for each athlete; coaches invite athletes and see the athletes they are responsible for. The web client is React and TypeScript, the public API is NestJS and TypeScript, and account, one-time link, and session data are persisted in PostgreSQL.

## Run locally

Requirements: Docker with Docker Compose, Node.js 22.12 or later, or both, depending on the mode.

### Everything in Docker

```sh
docker compose up
```

This builds and starts PostgreSQL, the API, and the web app with hot reload. The web app is at `http://localhost:5173` and the API at `http://localhost:3000`. Changes under `apps/api/src` and `apps/web/src`, and to `apps/web/index.html` and `apps/web/vite.config.ts`, reload automatically; run `docker compose up --build` after changing dependencies or any other file. Email is captured locally at `http://localhost:3000/auth/test/mailbox`; open a message's `url` to verify or recover an account, or to accept an invitation. No real email is sent.

### Node.js with the Docker database

```sh
npm ci
npm run dev:db
npm run dev
```

`npm run dev:db` starts only the Docker Compose PostgreSQL, and `npm run dev` runs the API and web app on the host against it, with the same addresses and local email inbox. The runner stops its processes on Ctrl+C, and reports how to start a database when none is reachable.

Copy `.env.example` to `.env` to use a PostgreSQL server you run through `DATABASE_URL` instead, or an SMTP service through `SMTP_URL` and `EMAIL_FROM`. `POSTGRES_PORT`, `PORT`, and `WEB_PORT` change the published ports in both modes; the test and smoke scripts also read `DATABASE_URL` and `POSTGRES_PORT` from `.env`.

Development data lives in the `wodyssey-postgres` Docker volume; `docker compose down -v` deletes it.

## Verify

```sh
npm run dev:db
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test:e2e:install
npm run test:e2e
```

`npm run check` runs all of these after the first two. The test runner creates a temporary database on the Docker Compose PostgreSQL, or on the server of `DATABASE_URL` when set, and drops it afterward, so development data is untouched. Browser journeys run in desktop and mobile Chromium, including keyboard navigation, recovery, session revocation, and failed-network retries. Public API tests cover validation, concurrency, and authorization. A separate run verifies expired links with a short test-only lifetime. Screenshots and failure traces are written to `test-results`.

Run a focused test with `npm run test:e2e -- account-api.spec.ts` or expiry checks with `npm run test:e2e:expired`. On Linux, install browser system dependencies with `npx playwright install --with-deps chromium`.

Smoke checks: `npm run test:dev-smoke` starts `npm run dev`, `npm run test:dev-smoke:compose` starts the Docker Compose environment and stops it afterward, and `npm run test:images` builds both production images and checks them. Continuous integration runs all of them on Linux.

The controlled mailbox requires both `EMAIL_TRANSPORT=memory` and `TEST_MAILBOX_ENABLED=true`. E2E runs also set `TEST_RATE_LIMIT_DISABLED=true` because every suite shares one client address. Test mailbox, shortened lifetime, and rate limit settings are rejected when `NODE_ENV=production`.

## Production images

Both images build from the repository root and do not depend on a hosting provider.

```sh
docker build -f apps/api/Dockerfile --target production -t wodyssey-api .
docker build -f apps/web/Dockerfile --target production --build-arg VITE_API_URL=https://api.example.com -t wodyssey-web .
```

The API image runs the compiled API with production dependencies only, listens on port 3000, applies pending migrations when it starts, and reports its health check at `/health`. Run it with `DATABASE_URL`, `WEB_ORIGIN` (the public web origin), `SMTP_URL`, and `EMAIL_FROM`.

The web image serves the compiled web app with nginx on port 8080, falling back to the app shell for client-side routes. `VITE_API_URL`, the public API origin, is compiled in at build time. Production cookies require HTTPS.

Without Docker, `npm run build` produces `apps/api/dist` (including migrations) and `apps/web/dist`; run the API with `NODE_ENV=production` and the variables above through `npm --workspace @wodyssey/api start`, setting `HOST` when binding beyond loopback.

The public account endpoints are `POST /auth/register`, `POST /auth/verification/consume`, `POST /auth/verification/resend`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password/forgot`, and `POST /auth/password/reset`. Authenticated sessions use an HttpOnly, SameSite=Lax cookie backed by a revocable PostgreSQL session. Verification and reset tokens are single-use, expire after 30 minutes, and are stored as hashes.

The organization endpoints require a session: `GET /organizations` lists the organizations of the signed-in account with its roles, `POST /organizations` creates one administered by its creator, and `GET /organizations/:id` and `PATCH /organizations/:id` read and rename it. Organizations the account does not belong to respond as not found.

Members and invitations live under an organization. Administrators list members with `GET /organizations/:id/members` and set their coach and athlete roles with `PATCH /organizations/:id/members/:accountId`; the administrator role is kept and every member keeps at least one role. `POST /organizations/:id/invitations` emails a one-time link for an email address and roles: administrators may invite coaches and athletes, coaches only athletes. `GET /organizations/:id/invitations` lists pending invitations (all of them for administrators, their own for coaches) and `DELETE /organizations/:id/invitations/:invitationId` revokes one. `POST /invitations/preview` shows what a pending invitation offers without signing in, and `POST /invitations/accept` grants its roles once, only to the signed-in account with the invited, verified email; invitations expire after 7 days.

Athletes have responsible coaches. `GET /organizations/:id/athletes` lists every athlete with their coaches for administrators, and only the athletes they are responsible for to coaches. Administrators replace an athlete's coaches with `PATCH /organizations/:id/athletes/:accountId`, choosing at least one member with the coach role. While an organization has a single coach, that coach is responsible for every athlete automatically; losing the coach or athlete role ends the responsibility.

The database schema is defined with Drizzle ORM in `apps/api/src/schema.ts`. After changing it, run `npm --workspace @wodyssey/api run db:generate` to generate a migration in `apps/api/src/migrations`. The API applies pending migrations whenever it starts, including dev server reloads, and records them in `drizzle.__drizzle_migrations`. Databases created by the earlier SQL migrations are not upgraded: run `docker compose down -v` to start from an empty database. The former `.local/development-postgres` folder is no longer used and can be deleted.

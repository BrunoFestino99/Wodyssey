# Wodyssey

The web app provides account registration, email verification, sign in, sign out, and password recovery. Signed-in accounts create organizations, administer them, and switch between them. The web client is React and TypeScript, the public API is NestJS and TypeScript, and account, one-time link, and session data are persisted in PostgreSQL.

## Run locally

Requirements: Node.js 22.12 or later. Docker is optional.

```sh
npm ci
npm run dev
```

The web app is at `http://localhost:5173`. The runner starts real PostgreSQL locally, preserves development data in `.local/development-postgres`, and stops its processes on Ctrl+C. Email is captured locally at `http://localhost:3000/auth/test/mailbox`; open a message's `url` to verify or recover an account. No real email is sent with the default development configuration.

Copy `.env.example` to `.env` to configure an existing PostgreSQL server through `DATABASE_URL`, or an SMTP service through `SMTP_URL` and `EMAIL_FROM`. The development runner loads this file. Docker users can optionally run `npm run dev:db` and configure its database URL.

## Verify

```sh
npm run typecheck
npm run lint
npm run format:check
npm run build
npm run test:e2e:install
npm run test:e2e
```

The test runner creates an isolated PostgreSQL database on a free port and cleans it up afterward. Browser journeys run in desktop and mobile Chromium, including keyboard navigation, recovery, session revocation, and failed-network retries. Public API tests cover validation, concurrency, and authorization. A separate run verifies expired links with a short test-only lifetime. Screenshots and failure traces are written to `test-results`.

Run a focused test with `npm run test:e2e -- account-api.spec.ts` or expiry checks with `npm run test:e2e:expired`. On Linux, install browser system dependencies with `npx playwright install --with-deps chromium`.

The controlled mailbox requires both `EMAIL_TRANSPORT=memory` and `TEST_MAILBOX_ENABLED=true`. E2E runs also set `TEST_RATE_LIMIT_DISABLED=true` because every suite shares one client address. Test mailbox, shortened lifetime, and rate limit settings are rejected when `NODE_ENV=production`.

## Compiled application

`npm run build` produces `apps/api/dist` (including migrations) and `apps/web/dist`. Set `DATABASE_URL`, `WEB_ORIGIN`, `SMTP_URL`, `EMAIL_FROM`, and `NODE_ENV=production`, then run `npm --workspace @wodyssey/api start`. Set `HOST` when binding beyond loopback. Serve the web build with SPA fallback routing and set `VITE_API_URL` at build time. Production cookies require HTTPS.

The public account endpoints are `POST /auth/register`, `POST /auth/verification/consume`, `POST /auth/verification/resend`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password/forgot`, and `POST /auth/password/reset`. Authenticated sessions use an HttpOnly, SameSite=Lax cookie backed by a revocable PostgreSQL session. Verification and reset tokens are single-use, expire after 30 minutes, and are stored as hashes.

The organization endpoints require a session: `GET /organizations` lists the organizations of the signed-in account with its roles, `POST /organizations` creates one administered by its creator, and `GET /organizations/:id` and `PATCH /organizations/:id` read and rename it. Organizations the account does not belong to respond as not found. Migrations in `apps/api/src/migrations` are applied once each, in name order, and recorded in `schema_migrations`.

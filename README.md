# Wodyssey account access

The first vertical slice provides account registration, email verification, sign in, sign out, and password recovery. The web client is React and TypeScript, the public API is NestJS and TypeScript, and account, one-time link, and session data are persisted in PostgreSQL.

## Run locally

Requirements: Node.js 20 or later and Docker Compose.

```sh
npm install
npm run dev:db
npm run dev
```

The API listens on `http://localhost:3000`; the web app listens on `http://localhost:5173`. Set `DATABASE_URL`, `WEB_ORIGIN`, `SMTP_URL`, and `EMAIL_FROM` for local email delivery. The API fails when account email is requested without a configured SMTP transport. The default database URL is `postgres://wodyssey:wodyssey@localhost:5432/wodyssey`.

## Verify

```sh
npm run typecheck
npm run lint
npm run test:e2e:install
npm run dev:db
npm run test:e2e
```

Browser tests run against the real Vite app, NestJS API, and PostgreSQL database. A separate public-API E2E run uses a short token lifetime to verify expired-link behavior. The E2E API process explicitly enables the in-memory email transport and its test-only mailbox endpoint; neither is available unless both `EMAIL_TRANSPORT=memory` and `TEST_MAILBOX_ENABLED=true` are set. The short token lifetime is ignored unless both test flags are active. Do not enable these options in a deployed environment.

The public account endpoints are `POST /auth/register`, `POST /auth/verification/consume`, `POST /auth/verification/resend`, `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/password/forgot`, and `POST /auth/password/reset`. Authenticated sessions use an HttpOnly, SameSite=Lax cookie backed by a revocable PostgreSQL session. Verification and reset tokens are single-use, expire after 30 minutes, and are stored as hashes.

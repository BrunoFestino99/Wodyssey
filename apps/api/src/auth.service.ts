import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { and, eq, gt, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import { hashToken, newToken } from './one-time-tokens';
import * as argon2 from 'argon2';
import { db, lower, now, type Transaction } from './database';
import { AccountEmailSender } from './email';
import { accounts, accountSessions, accountTokens, TOKEN_PURPOSES } from './schema';

export type SignedInAccount = { id: string; email: string };
type TokenPurpose = (typeof TOKEN_PURPOSES)[number];
const DEFAULT_TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
export const normalizedEmail = (email: string) => email.trim().toLowerCase();

function tokenLifetimeMs(): number {
  if (process.env.EMAIL_TRANSPORT === 'memory' && process.env.TEST_MAILBOX_ENABLED === 'true') {
    const testLifetime = Number(process.env.TEST_ACCOUNT_TOKEN_LIFETIME_MS);
    if (Number.isSafeInteger(testLifetime) && testLifetime >= 100 && testLifetime <= 60_000)
      return testLifetime;
  }
  return DEFAULT_TOKEN_LIFETIME_MS;
}

const tokenExpiresAt = () => new Date(Date.now() + tokenLifetimeMs());

const ACCOUNT_FIELDS = {
  id: accounts.id,
  email: accounts.email,
  passwordHash: accounts.passwordHash,
  emailVerifiedAt: accounts.emailVerifiedAt,
};

/** Tokens matching `match` that are not consumed and not expired. */
const usableTokens = (match: SQL, purpose: TokenPurpose) =>
  and(
    match,
    eq(accountTokens.purpose, purpose),
    isNull(accountTokens.consumedAt),
    gt(accountTokens.expiresAt, now()),
  );

/** Holds the account's row so concurrent token and credential changes run one at a time. */
async function lockAccount(tx: Transaction, accountId: string): Promise<void> {
  await tx
    .select({ id: accounts.id })
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .for('update');
}

@Injectable()
export class AuthService {
  constructor(private readonly emailSender: AccountEmailSender) {}
  private readonly dummyPasswordHash = argon2.hash('not-a-real-account-password', {
    type: argon2.argon2id,
  });

  async register(emailInput: string, password: string): Promise<void> {
    const email = normalizedEmail(emailInput);
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const token = await db.transaction(async (tx) => {
      // The query builder cannot target the expression index on lower(email).
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO ${accounts} (email, password_hash) VALUES (${email}, ${passwordHash})
        ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash
        WHERE ${accounts.emailVerifiedAt} IS NULL RETURNING id`);
      const account = rows[0];
      if (!account) return undefined;
      // A new registration replaces unconfirmed credentials and their links atomically.
      await tx
        .update(accountTokens)
        .set({ consumedAt: now() })
        .where(
          and(
            eq(accountTokens.accountId, account.id),
            eq(accountTokens.purpose, 'verification'),
            isNull(accountTokens.consumedAt),
          ),
        );
      const verificationToken = newToken();
      await tx.insert(accountTokens).values({
        accountId: account.id,
        tokenHash: hashToken(verificationToken),
        purpose: 'verification',
        expiresAt: tokenExpiresAt(),
      });
      return verificationToken;
    });
    if (token) await this.emailSender.send('verification', email, token);
  }

  async resendVerification(emailInput: string): Promise<void> {
    const account = await this.findByEmail(emailInput);
    if (account && !account.emailVerifiedAt)
      await this.issueToken(account.id, account.email, 'verification');
  }

  async verify(token: string): Promise<void> {
    await this.consumeToken(token, 'verification', async (accountId, tx) => {
      await tx
        .update(accounts)
        .set({ emailVerifiedAt: sql`coalesce(${accounts.emailVerifiedAt}, now())` })
        .where(eq(accounts.id, accountId));
    });
  }

  async login(
    emailInput: string,
    password: string,
  ): Promise<{ token: string; email: string; expiresAt: Date }> {
    return db.transaction(async (tx) => {
      const [account] = await tx
        .select(ACCOUNT_FIELDS)
        .from(accounts)
        .where(eq(lower(accounts.email), normalizedEmail(emailInput)))
        .for('update');
      const passwordHash = account?.passwordHash ?? (await this.dummyPasswordHash);
      const validPassword = await argon2.verify(passwordHash, password).catch(() => false);
      if (!account || !validPassword || !account.emailVerifiedAt) {
        throw new UnauthorizedException(
          'Email or password is incorrect, or email verification is required.',
        );
      }
      const token = newToken();
      const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
      await tx
        .insert(accountSessions)
        .values({ accountId: account.id, tokenHash: hashToken(token), expiresAt });
      return { token, email: account.email, expiresAt };
    });
  }

  async logout(token: unknown): Promise<void> {
    if (typeof token === 'string')
      await db.delete(accountSessions).where(eq(accountSessions.tokenHash, hashToken(token)));
  }

  async currentAccount(token: unknown): Promise<SignedInAccount | null> {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const [account] = await db
      .select({ id: accounts.id, email: accounts.email })
      .from(accountSessions)
      .innerJoin(accounts, eq(accounts.id, accountSessions.accountId))
      .where(
        and(
          eq(accountSessions.tokenHash, hashToken(token)),
          gt(accountSessions.expiresAt, now()),
          isNotNull(accounts.emailVerifiedAt),
        ),
      );
    return account ?? null;
  }

  async forgotPassword(emailInput: string): Promise<void> {
    const account = await this.findByEmail(emailInput);
    if (account && account.emailVerifiedAt)
      await this.issueToken(account.id, account.email, 'reset');
  }

  async resetPassword(token: string, password: string): Promise<void> {
    await this.consumeToken(token, 'reset', async (accountId, tx) => {
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      await tx.update(accounts).set({ passwordHash }).where(eq(accounts.id, accountId));
      await tx.delete(accountSessions).where(eq(accountSessions.accountId, accountId));
    });
  }

  readMailbox(email?: string) {
    return this.emailSender.readMailbox(email);
  }

  private async findByEmail(emailInput: string) {
    const [account] = await db
      .select(ACCOUNT_FIELDS)
      .from(accounts)
      .where(eq(lower(accounts.email), normalizedEmail(emailInput)));
    return account;
  }

  private async issueToken(accountId: string, email: string, purpose: TokenPurpose): Promise<void> {
    const token = newToken();
    await db.transaction(async (tx) => {
      await lockAccount(tx, accountId);
      await tx.insert(accountTokens).values({
        accountId,
        tokenHash: hashToken(token),
        purpose,
        expiresAt: tokenExpiresAt(),
      });
    });
    await this.emailSender.send(purpose, email, token);
  }

  private async consumeToken(
    token: string,
    purpose: TokenPurpose,
    action: (accountId: string, tx: Transaction) => Promise<void>,
  ): Promise<void> {
    if (typeof token !== 'string' || token.length < 32 || token.length > 256)
      throw new BadRequestException('This link is invalid or has expired.');
    const tokenHash = hashToken(token);
    await db.transaction(async (tx) => {
      const [candidate] = await tx
        .select({ accountId: accountTokens.accountId })
        .from(accountTokens)
        .where(usableTokens(eq(accountTokens.tokenHash, tokenHash), purpose));
      if (!candidate) throw new BadRequestException('This link is invalid or has expired.');
      await lockAccount(tx, candidate.accountId);
      const [consumed] = await tx
        .update(accountTokens)
        .set({ consumedAt: now() })
        .where(usableTokens(eq(accountTokens.tokenHash, tokenHash), purpose))
        .returning({ accountId: accountTokens.accountId });
      if (!consumed) throw new BadRequestException('This link is invalid or has expired.');
      await tx
        .update(accountTokens)
        .set({ consumedAt: now() })
        .where(usableTokens(eq(accountTokens.accountId, consumed.accountId), purpose));
      await action(consumed.accountId, tx);
    });
  }
}

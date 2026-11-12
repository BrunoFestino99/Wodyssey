import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes, createHash } from 'node:crypto';
import * as argon2 from 'argon2';
import { database, query } from './database';
import { AccountEmailSender } from './email';
import type { PoolClient } from 'pg';

export type SignedInAccount = { id: string; email: string };
type Account = { id: string; email: string; password_hash: string; email_verified_at: Date | null };
const DEFAULT_TOKEN_LIFETIME_MS = 30 * 60 * 1000;
const SESSION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;
const normalizedEmail = (email: string) => email.trim().toLowerCase();
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

function tokenLifetimeMs(): number {
  if (process.env.EMAIL_TRANSPORT === 'memory' && process.env.TEST_MAILBOX_ENABLED === 'true') {
    const testLifetime = Number(process.env.TEST_ACCOUNT_TOKEN_LIFETIME_MS);
    if (Number.isSafeInteger(testLifetime) && testLifetime >= 100 && testLifetime <= 60_000)
      return testLifetime;
  }
  return DEFAULT_TOKEN_LIFETIME_MS;
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
    const client = await database.connect();
    let token: string | undefined;
    try {
      await client.query('BEGIN');
      const result = await client.query<Account>(
        `INSERT INTO accounts(email, password_hash) VALUES ($1, $2)
         ON CONFLICT (lower(email)) DO UPDATE SET password_hash = EXCLUDED.password_hash
         WHERE accounts.email_verified_at IS NULL RETURNING id`,
        [email, passwordHash],
      );
      const account = result.rows[0];
      if (account) {
        // A new registration replaces unconfirmed credentials and their links atomically.
        await client.query(
          "UPDATE account_tokens SET consumed_at = now() WHERE account_id = $1 AND purpose = 'verification' AND consumed_at IS NULL",
          [account.id],
        );
        token = randomBytes(32).toString('base64url');
        await client.query(
          "INSERT INTO account_tokens(account_id, token_hash, purpose, expires_at) VALUES ($1, $2, 'verification', $3)",
          [account.id, hashToken(token), new Date(Date.now() + tokenLifetimeMs())],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    if (token) await this.emailSender.send('verification', email, token);
  }

  async resendVerification(emailInput: string): Promise<void> {
    const account = await this.findByEmail(emailInput);
    if (account && !account.email_verified_at)
      await this.issueToken(account.id, account.email, 'verification');
  }

  async verify(token: string): Promise<void> {
    await this.consumeToken(token, 'verification', async (accountId, client) => {
      await client.query(
        'UPDATE accounts SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1',
        [accountId],
      );
    });
  }

  async login(
    emailInput: string,
    password: string,
  ): Promise<{ token: string; email: string; expiresAt: Date }> {
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<Account>(
        'SELECT id, email, password_hash, email_verified_at FROM accounts WHERE lower(email) = $1 FOR UPDATE',
        [normalizedEmail(emailInput)],
      );
      const account = result.rows[0];
      const passwordHash = account?.password_hash ?? (await this.dummyPasswordHash);
      const validPassword = await argon2.verify(passwordHash, password).catch(() => false);
      if (!account || !validPassword || !account.email_verified_at) {
        throw new UnauthorizedException(
          'Email or password is incorrect, or email verification is required.',
        );
      }
      const token = randomBytes(32).toString('base64url');
      const expiresAt = new Date(Date.now() + SESSION_LIFETIME_MS);
      await client.query(
        'INSERT INTO account_sessions(account_id, token_hash, expires_at) VALUES ($1, $2, $3)',
        [account.id, hashToken(token), expiresAt],
      );
      await client.query('COMMIT');
      return { token, email: account.email, expiresAt };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async logout(token: unknown): Promise<void> {
    if (typeof token === 'string')
      await query('DELETE FROM account_sessions WHERE token_hash = $1', [hashToken(token)]);
  }

  async currentAccount(token: unknown): Promise<SignedInAccount | null> {
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const result = await query<SignedInAccount>(
      'SELECT a.id, a.email FROM account_sessions s JOIN accounts a ON a.id = s.account_id WHERE s.token_hash = $1 AND s.expires_at > now() AND a.email_verified_at IS NOT NULL',
      [hashToken(token)],
    );
    return result.rows[0] ?? null;
  }

  async forgotPassword(emailInput: string): Promise<void> {
    const account = await this.findByEmail(emailInput);
    if (account && account.email_verified_at)
      await this.issueToken(account.id, account.email, 'reset');
  }

  async resetPassword(token: string, password: string): Promise<void> {
    await this.consumeToken(token, 'reset', async (accountId, client) => {
      const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
      await client.query('UPDATE accounts SET password_hash = $1 WHERE id = $2', [
        passwordHash,
        accountId,
      ]);
      await client.query('DELETE FROM account_sessions WHERE account_id = $1', [accountId]);
    });
  }

  readMailbox(email?: string) {
    return this.emailSender.readMailbox(email);
  }

  private async findByEmail(emailInput: string): Promise<Account | undefined> {
    const result = await query<Account>(
      'SELECT id, email, password_hash, email_verified_at FROM accounts WHERE lower(email) = $1',
      [normalizedEmail(emailInput)],
    );
    return result.rows[0];
  }

  private async issueToken(
    accountId: string,
    email: string,
    purpose: 'verification' | 'reset',
  ): Promise<void> {
    const token = randomBytes(32).toString('base64url');
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [accountId]);
      await client.query(
        'INSERT INTO account_tokens(account_id, token_hash, purpose, expires_at) VALUES ($1, $2, $3, $4)',
        [accountId, hashToken(token), purpose, new Date(Date.now() + tokenLifetimeMs())],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    await this.emailSender.send(purpose, email, token);
  }

  private async consumeToken(
    token: string,
    purpose: 'verification' | 'reset',
    action: (accountId: string, client: PoolClient) => Promise<void>,
  ): Promise<void> {
    if (typeof token !== 'string' || token.length < 32 || token.length > 256)
      throw new BadRequestException('This link is invalid or has expired.');
    const client = await database.connect();
    try {
      await client.query('BEGIN');
      const candidate = await client.query<{ account_id: string }>(
        'SELECT account_id FROM account_tokens WHERE token_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()',
        [hashToken(token), purpose],
      );
      const candidateAccountId = candidate.rows[0]?.account_id;
      if (!candidateAccountId)
        throw new BadRequestException('This link is invalid or has expired.');
      await client.query('SELECT id FROM accounts WHERE id = $1 FOR UPDATE', [candidateAccountId]);
      const result = await client.query<{ account_id: string }>(
        'UPDATE account_tokens SET consumed_at = now() WHERE token_hash = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now() RETURNING account_id',
        [hashToken(token), purpose],
      );
      const accountId = result.rows[0]?.account_id;
      if (!accountId) throw new BadRequestException('This link is invalid or has expired.');
      await client.query(
        'UPDATE account_tokens SET consumed_at = now() WHERE account_id = $1 AND purpose = $2 AND consumed_at IS NULL AND expires_at > now()',
        [accountId, purpose],
      );
      await action(accountId, client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

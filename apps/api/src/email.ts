import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';

export type EmailType = 'verification' | 'reset' | 'invitation';

export type SentEmail = {
  type: EmailType;
  email: string;
  token: string;
  url: string;
  sentAt: string;
};

const LINK_PATHS: Record<EmailType, string> = {
  verification: '/verify',
  reset: '/reset',
  invitation: '/invitations',
};

/** The web address where a one-time link token is used. */
export function emailLink(type: EmailType, token: string): string {
  const link = new URL(LINK_PATHS[type], process.env.WEB_ORIGIN ?? 'http://localhost:5173');
  link.searchParams.set('token', token);
  return link.toString();
}

@Injectable()
export class AccountEmailSender {
  private readonly messages: SentEmail[] = [];

  async send(type: Exclude<EmailType, 'invitation'>, email: string, token: string): Promise<void> {
    const url = emailLink(type, token);
    await this.deliver(
      { type, email, token, url },
      type === 'verification' ? 'Verify your Wodyssey email' : 'Reset your Wodyssey password',
      `${type === 'verification' ? 'Verify your email' : 'Reset your password'} using this one-time link: ${url}\n\nThis link expires in 30 minutes. If you did not request this, you can ignore this email.`,
    );
  }

  async sendInvitation(email: string, token: string, organizationName: string): Promise<void> {
    const url = emailLink('invitation', token);
    await this.deliver(
      { type: 'invitation', email, token, url },
      `You're invited to join ${organizationName} on Wodyssey`,
      `You've been invited to join ${organizationName} on Wodyssey. Sign in or create an account with this email address, then accept using this one-time link: ${url}\n\nThis invitation expires in 7 days. If you weren't expecting it, you can ignore this email.`,
    );
  }

  readMailbox(email?: string): SentEmail[] {
    return this.messages.filter((message) => !email || message.email === email.toLowerCase());
  }

  private async deliver(
    message: Omit<SentEmail, 'sentAt'>,
    subject: string,
    text: string,
  ): Promise<void> {
    if (process.env.EMAIL_TRANSPORT === 'memory') {
      if (process.env.TEST_MAILBOX_ENABLED !== 'true')
        throw new Error('Memory email transport is restricted to explicit test mode');
      this.messages.push({ ...message, sentAt: new Date().toISOString() });
      return;
    }

    const smtpUrl = process.env.SMTP_URL;
    const sender = process.env.EMAIL_FROM;
    if (!smtpUrl || !sender) throw new Error('SMTP_URL and EMAIL_FROM are required to send email');
    const transport = nodemailer.createTransport(smtpUrl);
    try {
      await transport.sendMail({ from: sender, to: message.email, subject, text });
    } finally {
      transport.close();
    }
  }
}

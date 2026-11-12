import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';

export type AccountEmail = {
  type: 'verification' | 'reset';
  email: string;
  token: string;
  url: string;
  sentAt: string;
};

@Injectable()
export class AccountEmailSender {
  private readonly messages: AccountEmail[] = [];

  async send(type: AccountEmail['type'], email: string, token: string): Promise<void> {
    const link = new URL(
      type === 'verification' ? '/verify' : '/reset',
      process.env.WEB_ORIGIN ?? 'http://localhost:5173',
    );
    link.searchParams.set('token', token);
    const url = link.toString();
    if (process.env.EMAIL_TRANSPORT === 'memory') {
      if (process.env.TEST_MAILBOX_ENABLED !== 'true')
        throw new Error('Memory email transport is restricted to explicit test mode');
      this.messages.push({ type, email, token, url, sentAt: new Date().toISOString() });
      return;
    }

    const smtpUrl = process.env.SMTP_URL;
    const sender = process.env.EMAIL_FROM;
    if (!smtpUrl || !sender)
      throw new Error('SMTP_URL and EMAIL_FROM are required to send account email');
    const transport = nodemailer.createTransport(smtpUrl);
    try {
      await transport.sendMail({
        from: sender,
        to: email,
        subject:
          type === 'verification' ? 'Verify your Wodyssey email' : 'Reset your Wodyssey password',
        text: `${type === 'verification' ? 'Verify your email' : 'Reset your password'} using this one-time link: ${url}\n\nThis link expires in 30 minutes. If you did not request this, you can ignore this email.`,
      });
    } finally {
      transport.close();
    }
  }

  readMailbox(email?: string): AccountEmail[] {
    return this.messages.filter((message) => !email || message.email === email.toLowerCase());
  }
}

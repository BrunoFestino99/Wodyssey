import { Injectable } from '@nestjs/common';
import nodemailer from 'nodemailer';

export type AccountEmail = { type: 'verification' | 'reset'; email: string; token: string; sentAt: string };

@Injectable()
export class AccountEmailSender {
  private readonly messages: AccountEmail[] = [];

  async send(type: AccountEmail['type'], email: string, token: string): Promise<void> {
    if (process.env.EMAIL_TRANSPORT === 'memory') {
      if (process.env.TEST_MAILBOX_ENABLED !== 'true') throw new Error('Memory email transport is restricted to explicit test mode');
      this.messages.push({ type, email, token, sentAt: new Date().toISOString() });
      return;
    }

    const smtpUrl = process.env.SMTP_URL;
    const sender = process.env.EMAIL_FROM;
    if (!smtpUrl || !sender) throw new Error('SMTP_URL and EMAIL_FROM are required to send account email');
    const transport = nodemailer.createTransport(smtpUrl);
    const origin = process.env.WEB_ORIGIN ?? 'http://localhost:5173';
    const url = type === 'verification' ? `${origin}/verify?token=${encodeURIComponent(token)}` : `${origin}/reset?token=${encodeURIComponent(token)}`;
    try {
      await transport.sendMail({
        from: sender,
        to: email,
        subject: type === 'verification' ? 'Verify your Wodyssey email' : 'Reset your Wodyssey password',
        text: `${type === 'verification' ? 'Verify your email' : 'Reset your password'} using this one-time link: ${url}\n\nThis link expires in 30 minutes.`,
      });
    } finally {
      transport.close();
    }
  }

  readMailbox(email?: string): AccountEmail[] {
    return this.messages.filter((message) => !email || message.email === email.toLowerCase());
  }
}

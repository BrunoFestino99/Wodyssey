import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';
import { applyMigrations } from './migrations';

async function bootstrap(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    if (
      process.env.EMAIL_TRANSPORT === 'memory' ||
      process.env.TEST_MAILBOX_ENABLED === 'true' ||
      process.env.TEST_ACCOUNT_TOKEN_LIFETIME_MS ||
      process.env.TEST_INVITATION_LIFETIME_MS ||
      process.env.TEST_RATE_LIMIT_DISABLED
    ) {
      throw new Error('Test email, token and rate limit settings cannot be enabled in production.');
    }
    if (!process.env.SMTP_URL || !process.env.EMAIL_FROM)
      throw new Error('SMTP_URL and EMAIL_FROM are required in production.');
  }
  // Applying here, not in a separate step, keeps a reloaded dev server's schema current.
  await applyMigrations();
  const webOrigin = new URL(process.env.WEB_ORIGIN ?? 'http://localhost:5173').origin;
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.use((request: Request, response: Response, next: NextFunction) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      request.headers.origin &&
      request.headers.origin !== webOrigin
    ) {
      response.status(403).json({ message: 'This origin is not allowed.' });
      return;
    }
    next();
  });
  app.enableCors({ origin: webOrigin, credentials: true });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }),
  );
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT ?? 3000), process.env.HOST ?? '127.0.0.1');
}

void bootstrap();

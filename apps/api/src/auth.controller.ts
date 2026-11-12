import { Body, Controller, Get, HttpCode, Post, Query, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthService } from './auth.service';

class Credentials {
  @IsEmail() @MaxLength(254) email!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
class ResetCredentials {
  @IsString() @MinLength(32) @MaxLength(256) token!: string;
  @IsString() @MinLength(12) @MaxLength(128) password!: string;
}
class EmailAddress {
  @IsEmail() @MaxLength(254) email!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register') @HttpCode(202)
  async register(@Body() body: Credentials): Promise<{ message: string }> {
    await this.auth.register(body.email, body.password);
    return { message: 'If the address can be registered, a verification link has been sent.' };
  }

  @Post('verification/resend') @HttpCode(202)
  async resendVerification(@Body() body: EmailAddress): Promise<{ message: string }> {
    await this.auth.resendVerification(body.email);
    return { message: 'If the address needs verification, a link has been sent.' };
  }

  @Post('verification/consume') @HttpCode(200)
  async verify(@Body('token') token: string): Promise<{ verified: true }> {
    await this.auth.verify(token);
    return { verified: true };
  }

  @Post('login') @HttpCode(200)
  async login(@Body() body: Credentials, @Res({ passthrough: true }) response: Response): Promise<{ email: string }> {
    const session = await this.auth.login(body.email, body.password);
    response.cookie('wodyssey_session', session.token, this.cookieOptions(session.expiresAt));
    return { email: session.email };
  }

  @Post('logout') @HttpCode(204)
  async logout(@Req() request: Request, @Res({ passthrough: true }) response: Response): Promise<void> {
    await this.auth.logout(request.cookies?.wodyssey_session);
    response.clearCookie('wodyssey_session', { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/' });
  }

  @Get('me')
  async me(@Req() request: Request): Promise<{ email: string }> {
    const account = await this.auth.currentAccount(request.cookies?.wodyssey_session);
    if (!account) throw new UnauthorizedException();
    return account;
  }

  @Post('password/forgot') @HttpCode(202)
  async forgot(@Body() body: EmailAddress): Promise<{ message: string }> {
    await this.auth.forgotPassword(body.email);
    return { message: 'If an account exists for that address, a reset link has been sent.' };
  }

  @Post('password/reset') @HttpCode(200)
  async reset(@Body() body: ResetCredentials): Promise<{ reset: true }> {
    await this.auth.resetPassword(body.token, body.password);
    return { reset: true };
  }

  @Get('test/mailbox')
  testMailbox(@Query('email') email: string | undefined): unknown {
    if (process.env.TEST_MAILBOX_ENABLED !== 'true' || process.env.EMAIL_TRANSPORT !== 'memory') {
      throw new UnauthorizedException();
    }
    return this.auth.readMailbox(email);
  }

  private cookieOptions(expires: Date) {
    return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', expires };
  }
}

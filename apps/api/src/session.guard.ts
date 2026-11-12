import {
  createParamDecorator,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type SignedInAccount } from './auth.service';

type AuthenticatedRequest = Request & { account?: SignedInAccount };

/** Requires a valid session cookie and exposes its account to the handler. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const account = await this.auth.currentAccount(request.cookies?.wodyssey_session);
    if (!account) throw new UnauthorizedException();
    request.account = account;
    return true;
  }
}

export const CurrentAccount = createParamDecorator(
  (_data: unknown, context: ExecutionContext): SignedInAccount => {
    const account = context.switchToHttp().getRequest<AuthenticatedRequest>().account;
    if (!account) throw new UnauthorizedException();
    return account;
  },
);

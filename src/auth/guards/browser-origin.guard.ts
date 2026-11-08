import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';

import { getTrustedOrigins } from '../utils/trusted-origins';

@Injectable()
export class BrowserOriginGuard implements CanActivate {
  constructor(protected readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const origin = request.headers.origin;

    if (
      typeof origin !== 'string' ||
      !getTrustedOrigins(this.config).includes(origin)
    ) {
      throw new ForbiddenException('Untrusted request origin.');
    }

    return true;
  }
}

import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';

import { BrowserOriginGuard } from './browser-origin.guard';

@Injectable()
export class CookieCsrfGuard extends BrowserOriginGuard {
  constructor(config: ConfigService) {
    super(config);
  }

  canActivate(context: ExecutionContext): boolean {
    super.canActivate(context);

    const request = context.switchToHttp().getRequest<
      Request & {
        cookies?: Record<string, string>;
      }
    >();

    const cookieToken = request.cookies?.assetpass_csrf;
    const headerToken = request.headers['x-csrf-token'];

    // A 32-byte token encoded as unpadded base64url is 43 characters.
    const tokenPattern = /^[A-Za-z0-9_-]{43}$/;

    if (
      typeof cookieToken !== 'string' ||
      typeof headerToken !== 'string' ||
      !tokenPattern.test(cookieToken) ||
      !tokenPattern.test(headerToken)
    ) {
      throw new ForbiddenException('Invalid CSRF token.');
    }

    const cookieBuffer = Buffer.from(cookieToken, 'utf8');
    const headerBuffer = Buffer.from(headerToken, 'utf8');

    if (
      cookieBuffer.length !== headerBuffer.length ||
      !timingSafeEqual(cookieBuffer, headerBuffer)
    ) {
      throw new ForbiddenException('Invalid CSRF token.');
    }

    return true;
  }
}

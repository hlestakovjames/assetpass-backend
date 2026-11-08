import {
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { BrowserOriginGuard } from './browser-origin.guard';

describe('BrowserOriginGuard', () => {
  let guard: BrowserOriginGuard;

  const trustedOrigin = 'http://localhost:3000';

  const createContext = (origin?: string) => {
    const request = {
      headers: origin === undefined ? {} : { origin },
    };

    return {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  };

  beforeEach(() => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'TRUSTED_ORIGINS'
          ? trustedOrigin
          : undefined,
      ),
      getOrThrow: jest.fn().mockReturnValue(trustedOrigin),
    } as unknown as ConfigService;

    guard = new BrowserOriginGuard(config);
  });

  it('allows a configured frontend origin', () => {
    expect(
      guard.canActivate(createContext(trustedOrigin)),
    ).toBe(true);
  });

  it('rejects an untrusted origin', () => {
    expect(() =>
      guard.canActivate(createContext('https://attacker.example')),
    ).toThrow(ForbiddenException);
  });

  it('rejects a missing origin', () => {
    expect(() => guard.canActivate(createContext())).toThrow(
      ForbiddenException,
    );
  });

  it('rejects a null origin', () => {
    expect(() =>
      guard.canActivate(createContext('null')),
    ).toThrow(ForbiddenException);
  });

  it('does not accept a similar but different origin', () => {
    expect(() =>
      guard.canActivate(
        createContext('http://localhost:3000.attacker.example'),
      ),
    ).toThrow(ForbiddenException);
  });
});

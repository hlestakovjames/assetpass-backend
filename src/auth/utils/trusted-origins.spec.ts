import { ConfigService } from '@nestjs/config';
import { getTrustedOrigins } from './trusted-origins';

describe('getTrustedOrigins', () => {
  function createConfig(
    values: Record<string, string | undefined>,
  ): ConfigService {
    return {
      get: jest.fn((key: string) => values[key]),
      getOrThrow: jest.fn((key: string) => {
        const value = values[key];

        if (value === undefined) {
          throw new Error(`Missing configuration: ${key}`);
        }

        return value;
      }),
    } as unknown as ConfigService;
  }

  it('uses APP_ORIGIN when TRUSTED_ORIGINS is not configured', () => {
    expect(
      getTrustedOrigins(
        createConfig({
          APP_ORIGIN: 'http://localhost:3000',
        }),
      ),
    ).toEqual(['http://localhost:3000']);
  });

  it('normalizes and deduplicates trusted origins', () => {
    expect(
      getTrustedOrigins(
        createConfig({
          TRUSTED_ORIGINS:
            'https://example.com/, https://example.com, https://app.example.com',
        }),
      ),
    ).toEqual([
      'https://example.com',
      'https://app.example.com',
    ]);
  });

  it('rejects empty configuration', () => {
    expect(() =>
      getTrustedOrigins(createConfig({ TRUSTED_ORIGINS: '' })),
    ).toThrow();
  });

  it('rejects empty entries', () => {
    expect(() =>
      getTrustedOrigins(
        createConfig({
          TRUSTED_ORIGINS: 'https://example.com,,https://app.example.com',
        }),
      ),
    ).toThrow(/empty entries/i);
  });

  it('rejects malformed URLs', () => {
    expect(() =>
      getTrustedOrigins(
        createConfig({ TRUSTED_ORIGINS: 'not-a-url' }),
      ),
    ).toThrow(/valid URL/i);
  });

  it('rejects unsupported protocols', () => {
    expect(() =>
      getTrustedOrigins(
        createConfig({ TRUSTED_ORIGINS: 'ftp://example.com' }),
      ),
    ).toThrow();
  });

  it('rejects paths', () => {
    expect(() =>
      getTrustedOrigins(
        createConfig({ TRUSTED_ORIGINS: 'https://example.com/app' }),
      ),
    ).toThrow();
  });

  it('rejects credentials', () => {
    expect(() =>
      getTrustedOrigins(
        createConfig({
          TRUSTED_ORIGINS: 'https://user:password@example.com',
        }),
      ),
    ).toThrow();
  });

  it('rejects query strings and fragments', () => {
    expect(() =>
      getTrustedOrigins(
        createConfig({
          TRUSTED_ORIGINS: 'https://example.com?next=app',
        }),
      ),
    ).toThrow();

    expect(() =>
      getTrustedOrigins(
        createConfig({
          TRUSTED_ORIGINS: 'https://example.com#section',
        }),
      ),
    ).toThrow();
  });

  it('requires HTTPS in production', () => {
    expect(() =>
      getTrustedOrigins(
        createConfig({
          NODE_ENV: 'production',
          TRUSTED_ORIGINS: 'http://example.com',
        }),
      ),
    ).toThrow(/HTTPS in production/i);
  });

  it('allows HTTPS origins in production', () => {
    expect(
      getTrustedOrigins(
        createConfig({
          NODE_ENV: 'production',
          TRUSTED_ORIGINS: 'https://example.com',
        }),
      ),
    ).toEqual(['https://example.com']);
  });
});

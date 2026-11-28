import { validateEnvironment } from './env.validation';

describe('validateEnvironment trusted origins', () => {
  const baseEnvironment = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://assetpass:local@localhost:5432/assetpass',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    APP_ORIGIN: 'http://localhost:3000',
  };


  it('defaults trusted proxy hops to zero', () => {
    const result = validateEnvironment(baseEnvironment);

    expect(result.TRUST_PROXY_HOPS).toBe(0);
  });

  it('accepts an explicitly configured trusted proxy hop count', () => {
    const result = validateEnvironment({
      ...baseEnvironment,
      TRUST_PROXY_HOPS: '1',
    });

    expect(result.TRUST_PROXY_HOPS).toBe(1);
  });

  it('rejects invalid trusted proxy hop counts', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnvironment,
        TRUST_PROXY_HOPS: 'all',
      }),
    ).toThrow(/TRUST_PROXY_HOPS must be an integer/i);
  });

  it('uses APP_ORIGIN as the default trusted origin', () => {
    const result = validateEnvironment(baseEnvironment);

    expect(result.TRUSTED_ORIGINS).toBe('http://localhost:3000');
  });

  it('normalizes and deduplicates configured trusted origins', () => {
    const result = validateEnvironment({
      ...baseEnvironment,
      TRUSTED_ORIGINS:
        'http://localhost:3000/, http://localhost:3000, https://app.example.com',
    });

    expect(result.TRUSTED_ORIGINS).toBe(
      'http://localhost:3000,https://app.example.com',
    );
  });

  it('rejects empty trusted-origin entries', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnvironment,
        TRUSTED_ORIGINS: 'https://example.com,,https://app.example.com',
      }),
    ).toThrow(/empty entries/i);
  });

  it('rejects malformed trusted origins', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnvironment,
        TRUSTED_ORIGINS: 'not-a-url',
      }),
    ).toThrow(/valid URL/i);
  });

  it('rejects trusted origins containing paths', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnvironment,
        TRUSTED_ORIGINS: 'https://example.com/app',
      }),
    ).toThrow(/origins only/i);
  });

  it('rejects HTTP trusted origins in production', () => {
    expect(() =>
      validateEnvironment({
        ...baseEnvironment,
        NODE_ENV: 'production',
        APP_ORIGIN: 'https://app.example.com',
        TRUSTED_ORIGINS: 'https://app.example.com,http://localhost:3000',
      }),
    ).toThrow(/HTTPS in production/i);
  });

  it('accepts HTTPS trusted origins in production', () => {
    const result = validateEnvironment({
      ...baseEnvironment,
      NODE_ENV: 'production',
      APP_ORIGIN: 'https://app.example.com',
      TRUSTED_ORIGINS: 'https://app.example.com,https://admin.example.com',
    });

    expect(result.TRUSTED_ORIGINS).toBe(
      'https://app.example.com,https://admin.example.com',
    );
  });
});

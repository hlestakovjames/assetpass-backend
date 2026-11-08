import { validateEnvironment } from './env.validation';

describe('validateEnvironment trusted origins', () => {
  const baseEnvironment = {
    NODE_ENV: 'development',
    DATABASE_URL: 'postgresql://assetpass:local@localhost:5432/assetpass',
    JWT_ACCESS_SECRET: 'a'.repeat(64),
    APP_ORIGIN: 'http://localhost:3000',
  };

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

type Environment = Record<string, unknown>;

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;

  throw new Error('Environment variable must be true or false.');
}

function parseInteger(
  value: unknown,
  fallback: number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value ?? fallback);

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }

  return parsed;
}

function parseTrustedOrigins(
  value: unknown,
  fallback: string,
  production: boolean,
): string[] {
  const configured = String(value ?? fallback);

  if (!configured.trim()) {
    throw new Error('At least one trusted frontend origin is required.');
  }

  const entries = configured.split(',');

  if (entries.some((entry) => !entry.trim())) {
    throw new Error('TRUSTED_ORIGINS must not contain empty entries.');
  }

  const origins = entries.map((entry) => {
    const origin = entry.trim();

    let parsed: URL;

    try {
      parsed = new URL(origin);
    } catch {
      throw new Error('Each trusted frontend origin must be a valid URL.');
    }

    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    ) {
      throw new Error(
        'Trusted frontend origins must contain origins only, without paths, queries, fragments, or credentials.',
      );
    }

    if (production && parsed.protocol !== 'https:') {
      throw new Error('Trusted frontend origins must use HTTPS in production.');
    }

    return parsed.origin;
  });

  return [...new Set(origins)];
}

export function validateEnvironment(config: Environment): Environment {
  const nodeEnv = String(config.NODE_ENV ?? 'development');

  const port = parseInteger(config.PORT, 3001, 'PORT', 1, 65535);

  const databaseUrl = String(config.DATABASE_URL ?? '').trim();

  if (!databaseUrl) {
    throw new Error('DATABASE_URL is required.');
  }

  let parsedDatabaseUrl: URL;

  try {
    parsedDatabaseUrl = new URL(databaseUrl);
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }

  if (!['postgres:', 'postgresql:'].includes(parsedDatabaseUrl.protocol)) {
    throw new Error(
      'DATABASE_URL must use the postgres or postgresql protocol.',
    );
  }

  const dbSsl = parseBoolean(config.DB_SSL, false);

  const dbSslRejectUnauthorized = parseBoolean(
    config.DB_SSL_REJECT_UNAUTHORIZED,
    true,
  );

  const jwtAccessSecret = String(config.JWT_ACCESS_SECRET ?? '').trim();

  if (jwtAccessSecret.length < 64) {
    throw new Error('JWT_ACCESS_SECRET must contain at least 64 characters.');
  }

  const jwtAccessIssuer = String(
    config.JWT_ACCESS_ISSUER ?? 'assetpass-api',
  ).trim();

  const jwtAccessAudience = String(
    config.JWT_ACCESS_AUDIENCE ?? 'assetpass-app',
  ).trim();

  if (!jwtAccessIssuer || !jwtAccessAudience) {
    throw new Error('JWT_ACCESS_ISSUER and JWT_ACCESS_AUDIENCE are required.');
  }

  const appOrigin = String(config.APP_ORIGIN ?? 'http://localhost:3000').trim();

  let parsedAppOrigin: URL;

  try {
    parsedAppOrigin = new URL(appOrigin);
  } catch {
    throw new Error('APP_ORIGIN must be a valid URL.');
  }

  if (
    !['http:', 'https:'].includes(parsedAppOrigin.protocol) ||
    parsedAppOrigin.origin !== appOrigin ||
    parsedAppOrigin.username ||
    parsedAppOrigin.password
  ) {
    throw new Error(
      'APP_ORIGIN must be an origin without a path, query, or credentials.',
    );
  }

  if (nodeEnv === 'production' && parsedAppOrigin.protocol !== 'https:') {
    throw new Error('APP_ORIGIN must use HTTPS in production.');
  }

  const trustedOrigins = parseTrustedOrigins(
    config.TRUSTED_ORIGINS,
    appOrigin,
    nodeEnv === 'production',
  );

  const jwtAccessTtlSeconds = parseInteger(
    config.JWT_ACCESS_TTL_SECONDS,
    900,
    'JWT_ACCESS_TTL_SECONDS',
    60,
    3600,
  );

  const refreshTokenTtlDays = parseInteger(
    config.REFRESH_TOKEN_TTL_DAYS,
    30,
    'REFRESH_TOKEN_TTL_DAYS',
    1,
    90,
  );

  return {
    ...config,
    NODE_ENV: nodeEnv,
    PORT: port,
    DATABASE_URL: databaseUrl,
    DB_SSL: dbSsl,
    DB_SSL_REJECT_UNAUTHORIZED: dbSslRejectUnauthorized,
    JWT_ACCESS_SECRET: jwtAccessSecret,
    JWT_ACCESS_ISSUER: jwtAccessIssuer,
    JWT_ACCESS_AUDIENCE: jwtAccessAudience,
    APP_ORIGIN: appOrigin,
    TRUSTED_ORIGINS: trustedOrigins.join(','),
    JWT_ACCESS_TTL_SECONDS: jwtAccessTtlSeconds,
    REFRESH_TOKEN_TTL_DAYS: refreshTokenTtlDays,
  };
}

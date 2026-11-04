type Environment = Record<string, unknown>;

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === 'true' || value === '1') return true;
  if (value === false || value === 'false' || value === '0') return false;
  throw new Error('Environment variable must be true or false.');
}

export function validateEnvironment(config: Environment): Environment {
  const port = Number(config.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535.');
  }

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
    throw new Error('DATABASE_URL must use the postgres or postgresql protocol.');
  }

  const dbSsl = parseBoolean(config.DB_SSL, false);
  const dbSslRejectUnauthorized = parseBoolean(
    config.DB_SSL_REJECT_UNAUTHORIZED,
    true,
  );

  return {
    ...config,
    NODE_ENV: String(config.NODE_ENV ?? 'development'),
    PORT: port,
    DATABASE_URL: databaseUrl,
    DB_SSL: dbSsl,
    DB_SSL_REJECT_UNAUTHORIZED: dbSslRejectUnauthorized,
  };
}

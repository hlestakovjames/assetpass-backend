import { ConfigService } from '@nestjs/config';

export function getTrustedOrigins(config: ConfigService): string[] {
  const configured =
    config.get<string>('TRUSTED_ORIGINS') ??
    config.getOrThrow<string>('APP_ORIGIN');

  if (!configured.trim()) {
    throw new Error('At least one trusted frontend origin is required.');
  }

  const entries = configured.split(',');

  if (entries.some((entry) => !entry.trim())) {
    throw new Error('Trusted origins must not contain empty entries.');
  }

  const production = config.get<string>('NODE_ENV') === 'production';

  const origins = entries.map((entry) => {
    const value = entry.trim();

    let parsed: URL;

    try {
      parsed = new URL(value);
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
      throw new Error('Trusted origins must contain HTTP or HTTPS origins only.');
    }

    if (production && parsed.protocol !== 'https:') {
      throw new Error('Trusted origins must use HTTPS in production.');
    }

    return parsed.origin;
  });

  return [...new Set(origins)];
}

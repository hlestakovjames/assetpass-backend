import { ConfigService } from '@nestjs/config';
import { EmailDeliveryService } from './email-delivery.service';

describe('EmailDeliveryService password reset links', () => {
  const configValues: Record<string, string> = {
    NODE_ENV: 'production',
    EMAIL_PROVIDER: 'brevo',
    APP_ORIGIN: 'https://assetpass-app.vercel.app',
    TRUSTED_ORIGINS:
      'https://assetpass-app.vercel.app,https://assetpass-marketplace.vercel.app',
    BREVO_API_KEY: 'test-api-key',
    BREVO_SENDER_EMAIL: 'no-reply@assetpass.example',
    BREVO_SENDER_NAME: 'AssetPass',
  };

  let service: EmailDeliveryService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue({ ok: true });
    jest.spyOn(global, 'fetch').mockImplementation(fetchMock as unknown as typeof fetch);

    const config = {
      get: jest.fn((key: string) => configValues[key]),
      getOrThrow: jest.fn((key: string) => {
        const value = configValues[key];
        if (value === undefined) throw new Error(`Missing test configuration: ${key}`);
        return value;
      }),
    };

    service = new EmailDeliveryService(config as unknown as ConfigService);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('sends the reset link back to the exact trusted requesting application origin', async () => {
    await service.sendPasswordResetEmail(
      'person@example.com',
      'Test User',
      'a'.repeat(43),
      'https://assetpass-marketplace.vercel.app',
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload.textContent).toContain(
      'https://assetpass-marketplace.vercel.app/reset-password#' + 'a'.repeat(43),
    );
    expect(payload.htmlContent).toContain(
      'https://assetpass-marketplace.vercel.app/reset-password#' + 'a'.repeat(43),
    );
  });

  it('falls back to APP_ORIGIN when the requesting origin is not trusted', async () => {
    await service.sendPasswordResetEmail(
      'person@example.com',
      'Test User',
      'b'.repeat(43),
      'https://attacker.example',
    );

    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(payload.textContent).toContain(
      'https://assetpass-app.vercel.app/reset-password#' + 'b'.repeat(43),
    );
    expect(payload.textContent).not.toContain('attacker.example');
  });
});

import { JwtService } from '@nestjs/jwt';

import { AccessTokenService } from './access-token.service';

describe('AccessTokenService', () => {
  let service: AccessTokenService;
  let jwtService: jest.Mocked<Pick<JwtService, 'signAsync'>>;

  const userId = '9fed3a07-5a17-4b94-8437-552edeebf5a6';
  const sessionId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

  beforeEach(() => {
    jwtService = {
      signAsync: jest.fn().mockResolvedValue('signed-access-token'),
    };

    service = new AccessTokenService(jwtService as unknown as JwtService);
  });

  it('issues an access token bound to the supplied user and session', async () => {
    const token = await service.issueAccessToken(userId, sessionId);

    expect(token).toBe('signed-access-token');

    expect(jwtService.signAsync).toHaveBeenCalledWith({
      sub: userId,
      sid: sessionId,
      jti: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      ),
    });
  });

  it('generates a unique token identifier for each issuance', async () => {
    await service.issueAccessToken(userId, sessionId);
    await service.issueAccessToken(userId, sessionId);

    const firstPayload = jwtService.signAsync.mock.calls[0][0];
    const secondPayload = jwtService.signAsync.mock.calls[1][0];

    expect(firstPayload.sid).toBe(sessionId);
    expect(secondPayload.sid).toBe(sessionId);
    expect(firstPayload.jti).not.toBe(secondPayload.jti);
  });

  it('propagates signing failures', async () => {
    jwtService.signAsync.mockRejectedValueOnce(new Error('Signing failed'));

    await expect(
      service.issueAccessToken(userId, sessionId),
    ).rejects.toThrow('Signing failed');
  });
});

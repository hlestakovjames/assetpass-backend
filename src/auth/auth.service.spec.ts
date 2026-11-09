import { UnauthorizedException } from '@nestjs/common';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';

import { AuthService } from './auth.service';
import { User, UserStatus } from '../identity/entities/user.entity';

jest.mock('argon2', () => ({ verify: jest.fn() }));

describe('AuthService', () => {
  let service: AuthService;
  let usersRepository: jest.Mocked<Pick<Repository<User>, 'findOne'>>;

  const activeUser = {
    id: '9fed3a07-5a17-4b94-8437-552edeebf5a6',
    fullName: 'Platform Owner',
    email: 'owner@example.com',
    passwordHash: 'argon2id-hash',
    status: UserStatus.ACTIVE,
    emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    deactivatedAt: null,
  };

  const dummyPasswordHash =
    '$argon2id$v=19$m=65536,t=3,p=4$3ZTlvGN3OmrGRbrQBhd1Cw$d1CF+W/AlcxDREseDyczhDMdbhNVVa3L3h2VG5whT5Q';

  beforeEach(() => {
    usersRepository = { findOne: jest.fn() };
    service = new AuthService(usersRepository as unknown as Repository<User>);
    jest.clearAllMocks();
  });

  it('authenticates an approved active user even when email verification is pending', async () => {
    usersRepository.findOne.mockResolvedValue(activeUser as User);
    jest.mocked(argon2.verify).mockResolvedValue(true);

    const result = await service.validateCredentials(' OWNER@EXAMPLE.COM ', 'correct-password');

    expect(usersRepository.findOne).toHaveBeenCalledWith({
      where: { email: 'owner@example.com' },
      select: {
        id: true, fullName: true, email: true, passwordHash: true,
        status: true, deactivatedAt: true,
      },
    });
    expect(argon2.verify).toHaveBeenCalledWith('argon2id-hash', 'correct-password');
    expect(result).toEqual({
      id: activeUser.id, fullName: activeUser.fullName,
      email: activeUser.email, status: UserStatus.ACTIVE,
    });
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('performs dummy password verification for an unknown email', async () => {
    usersRepository.findOne.mockResolvedValue(null);
    jest.mocked(argon2.verify).mockResolvedValue(false);
    await expect(service.validateCredentials('unknown@example.com', 'password'))
      .rejects.toThrow('Invalid email or password.');
    expect(argon2.verify).toHaveBeenCalledWith(dummyPasswordHash, 'password');
  });

  it('rejects an incorrect password', async () => {
    usersRepository.findOne.mockResolvedValue(activeUser as User);
    jest.mocked(argon2.verify).mockResolvedValue(false);
    await expect(service.validateCredentials('owner@example.com', 'wrong-password'))
      .rejects.toThrow('Invalid email or password.');
  });

  it('rejects inactive accounts', async () => {
    usersRepository.findOne.mockResolvedValue({ ...activeUser, status: UserStatus.INACTIVE } as User);
    jest.mocked(argon2.verify).mockResolvedValue(true);
    await expect(service.validateCredentials('owner@example.com', 'correct-password'))
      .rejects.toThrow('Invalid email or password.');
  });

  it('allows an active approved account whose email has not yet been verified', async () => {
    usersRepository.findOne.mockResolvedValue({ ...activeUser, emailVerifiedAt: null } as User);
    jest.mocked(argon2.verify).mockResolvedValue(true);
    await expect(service.validateCredentials('owner@example.com', 'correct-password'))
      .resolves.toMatchObject({ id: activeUser.id, status: UserStatus.ACTIVE });
  });

  it('rejects suspended accounts', async () => {
    usersRepository.findOne.mockResolvedValue({ ...activeUser, status: UserStatus.SUSPENDED } as User);
    jest.mocked(argon2.verify).mockResolvedValue(true);
    await expect(service.validateCredentials('owner@example.com', 'correct-password'))
      .rejects.toThrow('Invalid email or password.');
  });

  it('rejects deactivated accounts', async () => {
    usersRepository.findOne.mockResolvedValue({ ...activeUser, deactivatedAt: new Date() } as User);
    jest.mocked(argon2.verify).mockResolvedValue(true);
    await expect(service.validateCredentials('owner@example.com', 'correct-password'))
      .rejects.toThrow('Invalid email or password.');
  });
});

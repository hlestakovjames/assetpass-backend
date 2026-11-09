import { Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';

import { User, UserStatus } from '../identity/entities/user.entity';

export type AuthenticatedIdentity = Pick<
  User,
  'id' | 'fullName' | 'email' | 'status'
>;

const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$3ZTlvGN3OmrGRbrQBhd1Cw$d1CF+W/AlcxDREseDyczhDMdbhNVVa3L3h2VG5whT5Q';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  async validateCredentials(
    email: string,
    password: string,
  ): Promise<AuthenticatedIdentity> {
    const normalizedEmail = email.trim().toLowerCase();

    const user = await this.usersRepository.findOne({
      where: { email: normalizedEmail },
      select: {
        id: true,
        fullName: true,
        email: true,
        passwordHash: true,
        status: true,
        deactivatedAt: true,
      },
    });

    // Always perform an Argon2 verification, including for unknown emails.
    const passwordHash = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    const passwordMatches = await argon2.verify(passwordHash, password);

    if (
      !user ||
      !passwordMatches ||
      user.status !== UserStatus.ACTIVE ||
      user.deactivatedAt !== null
    ) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      status: user.status,
    };
  }
}

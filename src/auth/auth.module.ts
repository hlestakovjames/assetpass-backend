import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { IdentityModule } from '../identity/identity.module';
import { AuthSession } from './auth-session.entity';
import { EmailVerification } from './email-verification.entity';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './auth.service';
import { RegistrationService } from './registration.service';
import { ResendEmailService } from './resend-email.service';
import { BrowserOriginGuard } from './guards/browser-origin.guard';
import { CookieCsrfGuard } from './guards/cookie-csrf.guard';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { RefreshTokenService } from './refresh-token.service';
import { AuthCookies } from './utils/auth-cookies';

@Module({
  imports: [
    ConfigModule,
    IdentityModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
          algorithm: 'HS256' as const,
          expiresIn: configService.getOrThrow<number>('JWT_ACCESS_TTL_SECONDS'),
          issuer: configService.getOrThrow<string>('JWT_ACCESS_ISSUER'),
          audience: configService.getOrThrow<string>('JWT_ACCESS_AUDIENCE'),
        },
      }),
    }),
    TypeOrmModule.forFeature([AuthSession, EmailVerification]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    RegistrationService,
    ResendEmailService,
    RefreshTokenService,
    AccessTokenService,
    AuthCookies,
    BrowserOriginGuard,
    CookieCsrfGuard,
    JwtStrategy,
    JwtAuthGuard,
  ],
  exports: [
    AuthService,
    RegistrationService,
    RefreshTokenService,
    AccessTokenService,
    JwtAuthGuard,
  ],
})
export class AuthModule {}

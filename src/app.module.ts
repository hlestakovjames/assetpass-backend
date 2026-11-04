import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import { validateEnvironment } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { IdentityModule } from './identity/identity.module';
import { PlatformGovernanceModule } from './platform-governance/platform-governance.module';
import { AuditModule } from './audit/audit.module';

import { AppController } from './app.controller';
import { AppService } from './app.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres' as const,
        url: config.getOrThrow<string>('DATABASE_URL'),
        ssl: config.get<boolean>('DB_SSL')
          ? {
              rejectUnauthorized: config.get<boolean>(
                'DB_SSL_REJECT_UNAUTHORIZED',
                true,
              ),
            }
          : false,
        uuidExtension: 'pgcrypto',
        autoLoadEntities: true,
        synchronize: false,
        migrationsRun: false,
        migrationsTableName: 'assetpass_migrations',
        retryAttempts: 5,
        retryDelay: 3000,
        logging:
          config.get<string>('NODE_ENV') === 'development'
            ? ['error', 'warn']
            : ['error'],
      }),
    }),
    HealthModule,
    IdentityModule,
    PlatformGovernanceModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

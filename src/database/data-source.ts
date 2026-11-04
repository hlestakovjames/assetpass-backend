import 'dotenv/config';
import { DataSource } from 'typeorm';
import { validateEnvironment } from '../config/env.validation';

const env = validateEnvironment(process.env);

export default new DataSource({
  type: 'postgres',
  url: String(env.DATABASE_URL),
  ssl: env.DB_SSL
    ? { rejectUnauthorized: env.DB_SSL_REJECT_UNAUTHORIZED as boolean }
    : false,
  uuidExtension: 'pgcrypto',
  entities: [__dirname + '/../**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  migrationsTableName: 'assetpass_migrations',
  synchronize: false,
  migrationsRun: false,
  logging: env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

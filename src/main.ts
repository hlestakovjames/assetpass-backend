import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import cookieParser = require('cookie-parser');

import { AppModule } from './app.module';
import { getTrustedOrigins } from './auth/utils/trusted-origins';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);

  const trustedOrigins = getTrustedOrigins(config);

  app.setGlobalPrefix('api/v1');

  app.use(cookieParser());

  app.enableCors({
    origin: trustedOrigins,
    credentials: true,
    methods: [
      'GET',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
    ],
    maxAge: 600,
  });

  app.enableShutdownHooks();

  await app.listen(
    config.get<number>('PORT') ?? 3001,
  );
}

bootstrap();

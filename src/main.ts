import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { APP_OPTIONS, configureApp } from './app.setup.js';
import type { Env } from './config/env.validation.js';

async function bootstrap() {
  // bufferLogs: hold startup logs until pino is in place, so even the first
  // lines are JSON.
  const app = await NestFactory.create(AppModule, {
    ...APP_OPTIONS,
    bufferLogs: true,
  });
  configureApp(app);
  const config = app.get<ConfigService<Env, true>>(ConfigService);
  await app.listen(config.get('PORT', { infer: true }));
}
await bootstrap();

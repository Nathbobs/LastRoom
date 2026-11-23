import type { INestApplication, NestApplicationOptions } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_KEY_HEADER } from './common/api-key.guard.js';
import { requestIdMiddleware } from './common/request-id.js';

/**
 * Options that must be given when the app is CREATED (they can't be applied
 * afterwards). rawBody keeps the exact request bytes on req.rawBody, which the
 * webhook signature check needs: re-serialising the parsed JSON would not
 * reproduce the bytes the channel signed (key order, whitespace, unicode escapes).
 */
export const APP_OPTIONS: NestApplicationOptions = { rawBody: true };

/**
 * App-level setup that isn't a Nest provider. Shared by main.ts and the
 * integration tests so both run the same app.
 */
export function configureApp(app: INestApplication): void {
  // First, so every response (errors and 404s included) carries a request id.
  app.use(requestIdMiddleware);
  app.enableShutdownHooks();

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('LastRoom API')
      .setDescription(
        'Per-night room inventory and reservations that never double-book. ' +
          'Errors always use { error: { code, message, details, requestId } }.',
      )
      .setVersion('0.2.0')
      .addApiKey(
        { type: 'apiKey', in: 'header', name: API_KEY_HEADER },
        'api-key',
      )
      .build(),
  );
  // UI at /docs, raw OpenAPI JSON at /docs-json. Served outside Nest's
  // controllers, so the API-key guard doesn't apply to the docs themselves.
  SwaggerModule.setup('docs', app, document);
}

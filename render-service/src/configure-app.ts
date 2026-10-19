import { ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';

/** Configuración HTTP compartida por main.ts y los e2e. */
export function configureApp(app: NestExpressApplication): void {
  // El audio llega en base64 dentro del JSON: el límite por defecto (100 kb) no alcanza.
  app.useBodyParser('json', { limit: '10mb' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

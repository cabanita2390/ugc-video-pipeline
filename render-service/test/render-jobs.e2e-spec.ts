import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import type { RenderJobAccepted } from './../src/render-jobs/interfaces/render-job-accepted.interface.js';

const validPayload = {
  ai_model_used: 'meta-llama/llama-3.3-70b-instruct:free',
  script: { hook: 'Hola', voiceover: 'Hola mundo' },
  audio_base64: 'SGVsbG8=',
  alignment: {
    characters: ['H', 'i'],
    character_start_times_seconds: [0, 0.1],
    character_end_times_seconds: [0.1, 0.2],
  },
};

describe('POST /render-jobs (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Misma configuración que el ValidationPipe global de main.ts.
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('202 con payload válido y devuelve ai_model_used', () => {
    return request(app.getHttpServer())
      .post('/render-jobs')
      .send(validPayload)
      .expect(202)
      .expect((res) => {
        const body = res.body as RenderJobAccepted;
        expect(body.status).toBe('accepted');
        expect(body.ai_model_used).toBe(validPayload.ai_model_used);
      });
  });

  it('400 sin ai_model_used', () => {
    const { ai_model_used: _omitted, ...withoutModel } = validPayload;
    return request(app.getHttpServer())
      .post('/render-jobs')
      .send(withoutModel)
      .expect(400);
  });

  it('400 con DTO anidado inválido (arrays de alineación de distinta longitud)', () => {
    return request(app.getHttpServer())
      .post('/render-jobs')
      .send({
        ...validPayload,
        alignment: { ...validPayload.alignment, character_end_times_seconds: [0.1] },
      })
      .expect(400);
  });

  it('400 con un campo no declarado en el DTO', () => {
    return request(app.getHttpServer())
      .post('/render-jobs')
      .send({ ...validPayload, extra: 1 })
      .expect(400);
  });
});

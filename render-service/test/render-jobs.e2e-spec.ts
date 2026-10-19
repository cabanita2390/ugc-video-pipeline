import { readFile } from 'node:fs/promises';
import path from 'node:path';
import request from 'supertest';
import type { RenderJobAccepted } from './../src/render-jobs/interfaces/render-job-accepted.interface.js';
import type { JobRecord } from './../src/render-jobs/queue/job-record.js';
import { FAKE_MP4, createTestApp, type TestApp } from './support/create-test-app.js';

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

const UNKNOWN_ID = '3f0a2b1c-4d5e-4f60-8a7b-9c0d1e2f3a4b';

describe('/render-jobs (e2e, worker falso)', () => {
  let t: TestApp;

  beforeEach(async () => {
    t = await createTestApp();
  });

  afterEach(async () => {
    await t.close();
  });

  async function createJob(): Promise<string> {
    const res = await request(t.app.getHttpServer()).post('/render-jobs').send(validPayload).expect(202);
    return (res.body as RenderJobAccepted).job_id;
  }

  describe('POST /render-jobs', () => {
    it('202 queued con job_id y ai_model_used, y escribe job.json', async () => {
      t.nextOutcome('hang');
      const res = await request(t.app.getHttpServer()).post('/render-jobs').send(validPayload).expect(202);
      const body = res.body as RenderJobAccepted;

      expect(body).toEqual({ job_id: expect.any(String), status: 'queued', ai_model_used: validPayload.ai_model_used });
      const onDisk: unknown = JSON.parse(await readFile(path.join(t.jobsDir, body.job_id, 'job.json'), 'utf8'));
      expect(onDisk).toMatchObject({ job_id: body.job_id, ai_model_used: validPayload.ai_model_used, hook: 'Hola' });
    });

    it('400 sin ai_model_used', () => {
      const { ai_model_used: _omitted, ...withoutModel } = validPayload;
      return request(t.app.getHttpServer()).post('/render-jobs').send(withoutModel).expect(400);
    });

    it('400 con DTO anidado inválido (arrays de alineación de distinta longitud)', () => {
      return request(t.app.getHttpServer())
        .post('/render-jobs')
        .send({
          ...validPayload,
          alignment: { ...validPayload.alignment, character_end_times_seconds: [0.1] },
        })
        .expect(400);
    });

    it('400 con un campo no declarado en el DTO', () => {
      return request(t.app.getHttpServer())
        .post('/render-jobs')
        .send({ ...validPayload, extra: 1 })
        .expect(400);
    });
  });

  describe('GET /render-jobs/:id', () => {
    it('devuelve el job.json y llega a done', async () => {
      const jobId = await createJob();
      await t.queue.whenIdle();

      const res = await request(t.app.getHttpServer()).get(`/render-jobs/${jobId}`).expect(200);
      const body = res.body as JobRecord;
      expect(body).toMatchObject({
        job_id: jobId,
        status: 'done',
        ai_model_used: validPayload.ai_model_used,
        hook: 'Hola',
        duration_seconds: 6,
        render_ms: 1234,
        error: null,
      });
    });

    it('muestra rendering mientras el render no termina', async () => {
      t.nextOutcome('hang');
      const jobId = await createJob();
      await vi.waitFor(async () => {
        const res = await request(t.app.getHttpServer()).get(`/render-jobs/${jobId}`).expect(200);
        expect((res.body as JobRecord).status).toBe('rendering');
      });
    });

    it('404 si no existe', () => {
      return request(t.app.getHttpServer()).get(`/render-jobs/${UNKNOWN_ID}`).expect(404);
    });

    it('400 si el id no es un UUID', () => {
      return request(t.app.getHttpServer()).get('/render-jobs/..%2F..%2Fetc').expect(400);
    });
  });

  describe('GET /render-jobs/:id/video', () => {
    it('200 video/mp4 cuando está done', async () => {
      const jobId = await createJob();
      await t.queue.whenIdle();

      const res = await request(t.app.getHttpServer())
        .get(`/render-jobs/${jobId}/video`)
        .buffer(true)
        .parse((response, callback) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => callback(null, Buffer.concat(chunks)));
        })
        .expect(200)
        .expect('Content-Type', 'video/mp4')
        .expect('Content-Length', String(FAKE_MP4.length));
      expect(res.body).toEqual(FAKE_MP4);
    });

    it('409 si aún no termina', async () => {
      t.nextOutcome('hang');
      const jobId = await createJob();
      await request(t.app.getHttpServer()).get(`/render-jobs/${jobId}/video`).expect(409);
    });

    it('409 si falló', async () => {
      t.nextOutcome('fail');
      const jobId = await createJob();
      await t.queue.whenIdle();

      const status = await request(t.app.getHttpServer()).get(`/render-jobs/${jobId}`).expect(200);
      expect(status.body).toMatchObject({ status: 'failed', error: 'hyperframes render falló (código 1, señal null):' });
      await request(t.app.getHttpServer()).get(`/render-jobs/${jobId}/video`).expect(409);
    });

    it('404 si no existe', () => {
      return request(t.app.getHttpServer()).get(`/render-jobs/${UNKNOWN_ID}/video`).expect(404);
    });

    it('400 si el id no es un UUID', () => {
      return request(t.app.getHttpServer()).get('/render-jobs/no-es-uuid/video').expect(400);
    });
  });
});

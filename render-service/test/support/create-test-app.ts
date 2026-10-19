import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AppModule } from './../../src/app.module.js';
import { configureApp } from './../../src/configure-app.js';
import type { CreateRenderJobDto } from './../../src/render-jobs/dto/create-render-job.dto.js';
import { RenderQueueService } from './../../src/render-jobs/queue/render-queue.service.js';
import {
  HyperframesRunnerService,
  OUTPUT_RELATIVE_PATH,
  type RenderResult,
} from './../../src/render-jobs/rendering/hyperframes-runner.service.js';
import type { JobLogContext } from './../../src/render-jobs/rendering/job-log-context.js';
import { JobWorkspaceService, type PreparedJob } from './../../src/render-jobs/rendering/job-workspace.service.js';
import { RENDER_CONFIG, loadRenderConfig } from './../../src/render-jobs/rendering/render-config.js';

/** Comportamiento del render falso para el siguiente job: termina bien, falla o se queda colgado. */
export type FakeRenderOutcome = 'done' | 'fail' | 'hang';

export const FAKE_MP4 = Buffer.from('fake mp4 bytes');

export interface TestApp {
  app: NestExpressApplication;
  jobsDir: string;
  queue: RenderQueueService;
  /** Lo que hará el próximo `run()` (por defecto `done`). */
  nextOutcome: (outcome: FakeRenderOutcome) => void;
  /** Libera los renders colgados y cierra la app. */
  close: () => Promise<void>;
}

/**
 * App completa (AppModule + configureApp) con JOBS_DIR en una carpeta temporal y el worker
 * (prepare + run) reemplazado: los e2e nunca lanzan ffprobe ni hyperframes.
 */
export async function createTestApp(): Promise<TestApp> {
  const jobsDir = await mkdtemp(path.join(os.tmpdir(), 'e2e-jobs-'));
  const outcomes: FakeRenderOutcome[] = [];
  const hanging: Array<() => void> = [];
  let released = false;

  const workspace = {
    prepare: (jobId: string, _dto: CreateRenderJobDto): Promise<PreparedJob> =>
      Promise.resolve({ jobDir: path.join(jobsDir, jobId), durationSeconds: 6, wordCount: 1 }),
  };
  const runner = {
    run: async (jobDir: string, _duration: number, _ctx: JobLogContext): Promise<RenderResult> => {
      const outcome = outcomes.shift() ?? 'done';
      if (outcome === 'fail') throw new Error('hyperframes render falló (código 1, señal null):');
      if (outcome === 'hang' && !released) await new Promise<void>((resolve) => hanging.push(resolve));
      const outputPath = path.join(jobDir, OUTPUT_RELATIVE_PATH);
      await mkdir(path.dirname(outputPath), { recursive: true });
      await writeFile(outputPath, FAKE_MP4);
      return { outputPath, elapsedMs: 1234 };
    },
  };

  const moduleFixture = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(RENDER_CONFIG)
    .useValue({ ...loadRenderConfig({}), jobsDir })
    .overrideProvider(JobWorkspaceService)
    .useValue(workspace)
    .overrideProvider(HyperframesRunnerService)
    .useValue(runner)
    .compile();

  const app = moduleFixture.createNestApplication<NestExpressApplication>();
  configureApp(app);
  await app.init();
  const queue = app.get(RenderQueueService);

  return {
    app,
    jobsDir,
    queue,
    nextOutcome: (outcome) => outcomes.push(outcome),
    close: async () => {
      // Un job puede no haber llegado aún a run(): con `released` ya no se cuelga.
      released = true;
      for (const release of hanging) release();
      await queue.whenIdle();
      await app.close();
      await rm(jobsDir, { recursive: true, force: true });
    },
  };
}

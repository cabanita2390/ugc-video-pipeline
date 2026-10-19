import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CreateRenderJobDto } from '../dto/create-render-job.dto.js';
import type { HyperframesRunnerService, RenderResult } from '../rendering/hyperframes-runner.service.js';
import type { JobLogContext } from '../rendering/job-log-context.js';
import type { JobWorkspaceService, PreparedJob } from '../rendering/job-workspace.service.js';
import { loadRenderConfig } from '../rendering/render-config.js';
import type { JobRecord } from './job-record.js';
import { JobStoreService } from './job-store.service.js';
import { RenderQueueService, shortError } from './render-queue.service.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function dto(hook: string): CreateRenderJobDto {
  return {
    ai_model_used: 'meta-llama/llama-3.3-70b-instruct:free',
    script: { hook, voiceover: 'Hola' },
    audio_base64: 'SGVsbG8=',
    alignment: { characters: ['H'], character_start_times_seconds: [0], character_end_times_seconds: [0.1] },
  };
}

/** Espera a que `predicate` se cumpla, dando vueltas al event loop (E/S real de job.json). */
async function until(predicate: () => boolean | Promise<boolean>): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('condición no alcanzada');
}

describe('RenderQueueService', () => {
  let jobsDir: string;
  let store: JobStoreService;
  let runs: Map<string, Deferred<RenderResult>>;
  let workspace: { prepare: ReturnType<typeof vi.fn<(jobId: string, d: CreateRenderJobDto) => Promise<PreparedJob>>> };
  let runner: {
    run: ReturnType<typeof vi.fn<(jobDir: string, duration: number, ctx: JobLogContext) => Promise<RenderResult>>>;
  };
  let queue: RenderQueueService;

  beforeEach(async () => {
    jobsDir = await mkdtemp(path.join(os.tmpdir(), 'queue-spec-'));
    store = new JobStoreService({ ...loadRenderConfig({}), jobsDir });
    runs = new Map();
    workspace = {
      prepare: vi.fn((jobId: string) =>
        Promise.resolve({ jobDir: store.jobDir(jobId), durationSeconds: 6, wordCount: 1 }),
      ),
    };
    runner = {
      run: vi.fn((_jobDir: string, _duration: number, ctx: JobLogContext) => {
        const d = deferred<RenderResult>();
        runs.set(ctx.job_id, d);
        return d.promise;
      }),
    };
    queue = new RenderQueueService(
      store,
      workspace as unknown as JobWorkspaceService,
      runner as unknown as HyperframesRunnerService,
    );
  });

  afterEach(async () => {
    for (const d of runs.values()) d.resolve({ outputPath: '', elapsedMs: 0 });
    await queue.whenIdle();
    await rm(jobsDir, { recursive: true, force: true });
  });

  it('concurrencia 1: el segundo job no empieza hasta que termina el primero', async () => {
    const first = await queue.enqueue(dto('uno'));
    const second = await queue.enqueue(dto('dos'));

    await until(() => runs.has(first.job_id));
    expect(workspace.prepare).toHaveBeenCalledTimes(1);
    expect((await store.read(second.job_id))?.status).toBe('queued');

    runs.get(first.job_id)?.resolve({ outputPath: 'x.mp4', elapsedMs: 1000 });
    await until(() => runs.has(second.job_id));

    expect((await store.read(first.job_id))?.status).toBe('done');
    expect((await store.read(second.job_id))?.status).toBe('rendering');
    expect(workspace.prepare.mock.calls.map(([id]) => id)).toEqual([first.job_id, second.job_id]);
  });

  it('transiciones queued → rendering → done con job.json completo', async () => {
    const accepted = await queue.enqueue(dto('Mi hook'));
    const queued = await store.read(accepted.job_id);
    expect(queued).toMatchObject({
      status: 'queued',
      hook: 'Mi hook',
      ai_model_used: 'meta-llama/llama-3.3-70b-instruct:free',
      started_at: null,
      finished_at: null,
      duration_seconds: null,
      render_ms: null,
      error: null,
    });
    expect(Date.parse(queued?.created_at ?? '')).not.toBeNaN();

    await until(() => runs.has(accepted.job_id));
    const rendering = await store.read(accepted.job_id);
    expect(rendering).toMatchObject({ status: 'rendering', duration_seconds: 6, finished_at: null });
    expect(rendering?.started_at).not.toBeNull();

    runs.get(accepted.job_id)?.resolve({ outputPath: 'x.mp4', elapsedMs: 31_455 });
    await queue.whenIdle();

    const done = (await store.read(accepted.job_id)) as JobRecord;
    expect(done).toMatchObject({ status: 'done', render_ms: 31_455, duration_seconds: 6, error: null });
    expect(Date.parse(done.finished_at ?? '')).toBeGreaterThanOrEqual(Date.parse(done.started_at ?? ''));
    expect(runner.run).toHaveBeenCalledWith(store.jobDir(accepted.job_id), 6, {
      job_id: accepted.job_id,
      ai_model_used: 'meta-llama/llama-3.3-70b-instruct:free',
    });
  });

  it('un fallo del render deja el job en failed con un error corto y sigue con el siguiente', async () => {
    const failing = await queue.enqueue(dto('falla'));
    const next = await queue.enqueue(dto('siguiente'));

    await until(() => runs.has(failing.job_id));
    runs.get(failing.job_id)?.reject(new Error('hyperframes render falló (código 1):\n[err] detalle largo'));
    await until(() => runs.has(next.job_id));

    expect(await store.read(failing.job_id)).toMatchObject({
      status: 'failed',
      error: 'hyperframes render falló (código 1):',
      render_ms: null,
    });
    expect((await store.read(failing.job_id))?.finished_at).not.toBeNull();
  });

  it('un fallo de prepare también deja el job en failed', async () => {
    workspace.prepare.mockRejectedValueOnce(new Error('ffprobe salió con código 1'));
    const accepted = await queue.enqueue(dto('sin audio'));
    await queue.whenIdle();

    expect(runner.run).not.toHaveBeenCalled();
    expect(await store.read(accepted.job_id)).toMatchObject({
      status: 'failed',
      error: 'ffprobe salió con código 1',
      duration_seconds: null,
    });
  });

  it('onModuleInit marca como failed los jobs interrumpidos', async () => {
    const accepted = await queue.enqueue(dto('interrumpido'));
    await until(() => runs.has(accepted.job_id));

    // Simula un reinicio: otra instancia sobre la misma carpeta.
    const restarted = new RenderQueueService(
      store,
      workspace as unknown as JobWorkspaceService,
      runner as unknown as HyperframesRunnerService,
    );
    await restarted.onModuleInit();

    expect(await store.read(accepted.job_id)).toMatchObject({
      status: 'failed',
      error: 'interrupted by restart',
    });
  });
});

describe('shortError', () => {
  it('se queda con la primera línea y la recorta', () => {
    expect(shortError(new Error('primera\nsegunda'))).toBe('primera');
    expect(shortError('x'.repeat(400))).toHaveLength(300);
  });
});

import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadRenderConfig } from '../rendering/render-config.js';
import type { JobRecord } from './job-record.js';
import { INTERRUPTED_ERROR, JOB_FILE, JobStoreService } from './job-store.service.js';

function record(jobId: string, overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    job_id: jobId,
    status: 'queued',
    ai_model_used: 'meta-llama/llama-3.3-70b-instruct:free',
    hook: 'Hook',
    created_at: '2026-10-18T10:00:00.000Z',
    started_at: null,
    finished_at: null,
    duration_seconds: null,
    render_ms: null,
    error: null,
    ...overrides,
  };
}

describe('JobStoreService', () => {
  let jobsDir: string;
  let store: JobStoreService;

  beforeEach(async () => {
    jobsDir = await mkdtemp(path.join(os.tmpdir(), 'job-store-spec-'));
    store = new JobStoreService({ ...loadRenderConfig({}), jobsDir });
  });

  afterEach(async () => {
    await rm(jobsDir, { recursive: true, force: true });
  });

  it('escribe job.json, lo sobrescribe y no deja temporales', async () => {
    await store.write(record('a'));
    await store.write(record('a', { status: 'rendering', started_at: '2026-10-18T10:00:01.000Z' }));

    expect(await readdir(path.join(jobsDir, 'a'))).toEqual([JOB_FILE]);
    const onDisk: unknown = JSON.parse(await readFile(path.join(jobsDir, 'a', JOB_FILE), 'utf8'));
    expect(onDisk).toMatchObject({ status: 'rendering', started_at: '2026-10-18T10:00:01.000Z' });
    expect(await store.read('a')).toEqual(onDisk);
  });

  it('read devuelve null si el job no existe', async () => {
    expect(await store.read('no-existe')).toBeNull();
  });

  it('read falla si job.json no tiene el formato esperado', async () => {
    await mkdir(path.join(jobsDir, 'roto'));
    await writeFile(path.join(jobsDir, 'roto', JOB_FILE), '{"status":"otro"}');
    await expect(store.read('roto')).rejects.toThrow(/formato/);
  });

  it('al arrancar marca failed los queued y rendering, y deja el resto igual', async () => {
    await store.write(record('q'));
    await store.write(record('r', { status: 'rendering', started_at: '2026-10-18T10:00:01.000Z' }));
    await store.write(record('d', { status: 'done', finished_at: '2026-10-18T10:00:30.000Z', render_ms: 29_000 }));
    await store.write(record('f', { status: 'failed', error: 'boom' }));
    await mkdir(path.join(jobsDir, 'sin-job-json'));

    const now = new Date('2026-10-18T11:00:00.000Z');
    const updated = await store.failInterrupted(now);

    expect(updated.map((r) => r.job_id).sort()).toEqual(['q', 'r']);
    for (const id of ['q', 'r']) {
      expect(await store.read(id)).toMatchObject({
        status: 'failed',
        error: INTERRUPTED_ERROR,
        finished_at: now.toISOString(),
      });
    }
    expect(await store.read('r')).toMatchObject({ started_at: '2026-10-18T10:00:01.000Z' });
    expect(await store.read('d')).toMatchObject({ status: 'done', error: null });
    expect(await store.read('f')).toMatchObject({ status: 'failed', error: 'boom' });
  });

  it('failInterrupted no falla si JOBS_DIR aún no existe', async () => {
    const missing = new JobStoreService({ ...loadRenderConfig({}), jobsDir: path.join(jobsDir, 'nada') });
    expect(await missing.failInterrupted()).toEqual([]);
  });
});

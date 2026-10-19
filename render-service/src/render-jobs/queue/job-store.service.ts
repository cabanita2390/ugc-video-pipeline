import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { RENDER_CONFIG, type RenderConfig } from '../rendering/render-config.js';
import { JOB_STATUSES, type JobRecord } from './job-record.js';

export const JOB_FILE = 'job.json';
export const INTERRUPTED_ERROR = 'interrupted by restart';

/** En Windows, un antivirus o un lector puede bloquear el destino del rename un instante. */
const RENAME_RETRIES = 5;
const RENAME_RETRY_DELAY_MS = 50;

/** Lee y escribe `jobs/<job_id>/job.json`. Las escrituras son atómicas (temporal + rename). */
@Injectable()
export class JobStoreService {
  constructor(@Inject(RENDER_CONFIG) private readonly config: RenderConfig) {}

  jobDir(jobId: string): string {
    return path.join(this.config.jobsDir, jobId);
  }

  async write(record: JobRecord): Promise<void> {
    const dir = this.jobDir(record.job_id);
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, JOB_FILE);
    const tmp = path.join(dir, `${JOB_FILE}.${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(record, null, 2));
    try {
      await renameWithRetry(tmp, target);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
  }

  /** `null` si el job no existe. */
  async read(jobId: string): Promise<JobRecord | null> {
    let raw: string;
    try {
      raw = await readFile(path.join(this.jobDir(jobId), JOB_FILE), 'utf8');
    } catch (err) {
      if (isErrnoCode(err, 'ENOENT')) return null;
      throw err;
    }
    const parsed: unknown = JSON.parse(raw);
    if (!isJobRecord(parsed)) {
      throw new Error(`${JOB_FILE} de ${jobId} no tiene el formato esperado`);
    }
    return parsed;
  }

  /**
   * Al arrancar, nada está renderizando: los jobs que quedaron `queued` o `rendering`
   * pasan a `failed`. Devuelve los registros actualizados.
   */
  async failInterrupted(now: Date = new Date()): Promise<JobRecord[]> {
    let entries: string[];
    try {
      entries = await readdir(this.config.jobsDir);
    } catch (err) {
      if (isErrnoCode(err, 'ENOENT')) return [];
      throw err;
    }
    const updated: JobRecord[] = [];
    for (const jobId of entries) {
      const record = await this.read(jobId).catch(() => null);
      if (!record || (record.status !== 'queued' && record.status !== 'rendering')) continue;
      const failed: JobRecord = {
        ...record,
        status: 'failed',
        finished_at: now.toISOString(),
        error: INTERRUPTED_ERROR,
      };
      await this.write(failed);
      updated.push(failed);
    }
    return updated;
  }
}

async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (err) {
      const retriable = isErrnoCode(err, 'EPERM') || isErrnoCode(err, 'EBUSY') || isErrnoCode(err, 'EACCES');
      if (!retriable || attempt >= RENAME_RETRIES) throw err;
      await new Promise((resolve) => setTimeout(resolve, RENAME_RETRY_DELAY_MS * attempt));
    }
  }
}

function isErrnoCode(err: unknown, code: string): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === code;
}

function isJobRecord(value: unknown): value is JobRecord {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.job_id === 'string' &&
    typeof v.status === 'string' &&
    (JOB_STATUSES as readonly string[]).includes(v.status) &&
    typeof v.ai_model_used === 'string' &&
    typeof v.created_at === 'string'
  );
}

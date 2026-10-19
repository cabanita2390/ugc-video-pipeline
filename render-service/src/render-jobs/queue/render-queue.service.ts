import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { CreateRenderJobDto } from '../dto/create-render-job.dto.js';
import { HyperframesRunnerService } from '../rendering/hyperframes-runner.service.js';
import { type JobLogContext, logJobError, logJobEvent } from '../rendering/job-log-context.js';
import { JobWorkspaceService } from '../rendering/job-workspace.service.js';
import type { JobRecord } from './job-record.js';
import { JobStoreService } from './job-store.service.js';

const MAX_ERROR_LENGTH = 300;

interface QueuedJob {
  record: JobRecord;
  /** El payload (con el audio en base64) vive en memoria hasta que el worker lo prepara. */
  dto: CreateRenderJobDto;
}

/** Cola en memoria con concurrencia 1: un único `hyperframes render` a la vez. */
@Injectable()
export class RenderQueueService implements OnModuleInit {
  private readonly logger = new Logger(RenderQueueService.name);
  private readonly pending: QueuedJob[] = [];
  private draining: Promise<void> | null = null;

  constructor(
    private readonly store: JobStoreService,
    private readonly workspace: JobWorkspaceService,
    private readonly runner: HyperframesRunnerService,
  ) {}

  async onModuleInit(): Promise<void> {
    const interrupted = await this.store.failInterrupted();
    for (const record of interrupted) {
      logJobError(this.logger, contextOf(record), 'job_interrupted_by_restart', { status: record.status });
    }
  }

  /** Escribe job.json en `queued`, encola y devuelve sin esperar al render. */
  async enqueue(dto: CreateRenderJobDto): Promise<JobRecord> {
    const record: JobRecord = {
      job_id: randomUUID(),
      status: 'queued',
      ai_model_used: dto.ai_model_used,
      hook: dto.script.hook,
      created_at: new Date().toISOString(),
      started_at: null,
      finished_at: null,
      duration_seconds: null,
      render_ms: null,
      error: null,
    };
    await this.store.write(record);
    this.pending.push({ record, dto });
    logJobEvent(this.logger, contextOf(record), 'job_queued', {
      hook: record.hook,
      queue_length: this.pending.length,
    });
    this.draining ??= this.drain().finally(() => {
      this.draining = null;
    });
    return record;
  }

  /** Se resuelve cuando la cola queda vacía (para tests y apagado ordenado). */
  async whenIdle(): Promise<void> {
    while (this.draining) await this.draining;
  }

  private async drain(): Promise<void> {
    for (let job = this.pending.shift(); job; job = this.pending.shift()) {
      await this.process(job);
    }
  }

  private async process({ record, dto }: QueuedJob): Promise<void> {
    const ctx = contextOf(record);
    let current = record;
    try {
      current = await this.transition(current, { status: 'rendering', started_at: new Date().toISOString() });
      logJobEvent(this.logger, ctx, 'job_started', { queue_length: this.pending.length });
      const prepared = await this.workspace.prepare(record.job_id, dto);
      current = await this.transition(current, { duration_seconds: prepared.durationSeconds });
      const result = await this.runner.run(prepared.jobDir, prepared.durationSeconds, ctx);
      await this.transition(current, {
        status: 'done',
        finished_at: new Date().toISOString(),
        render_ms: result.elapsedMs,
      });
      logJobEvent(this.logger, ctx, 'job_done', {
        duration_seconds: prepared.durationSeconds,
        render_ms: result.elapsedMs,
      });
    } catch (err) {
      const error = shortError(err);
      logJobError(this.logger, ctx, 'job_failed', { error });
      await this.transition(current, { status: 'failed', finished_at: new Date().toISOString(), error }).catch(
        (writeErr: unknown) =>
          logJobError(this.logger, ctx, 'job_record_write_failed', { error: shortError(writeErr) }),
      );
    }
  }

  private async transition(record: JobRecord, changes: Partial<JobRecord>): Promise<JobRecord> {
    const next: JobRecord = { ...record, ...changes };
    await this.store.write(next);
    if (changes.status) {
      logJobEvent(this.logger, contextOf(next), 'job_status_changed', { from: record.status, to: next.status });
    }
    return next;
  }
}

function contextOf(record: JobRecord): JobLogContext {
  return { job_id: record.job_id, ai_model_used: record.ai_model_used };
}

/** Primera línea del error, recortada: el detalle completo va al log. */
export function shortError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  const firstLine = message.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > MAX_ERROR_LENGTH ? `${firstLine.slice(0, MAX_ERROR_LENGTH - 1)}…` : firstLine;
}

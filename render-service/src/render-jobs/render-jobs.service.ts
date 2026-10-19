import { ConflictException, Injectable, NotFoundException, StreamableFile } from '@nestjs/common';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { CreateRenderJobDto } from './dto/create-render-job.dto.js';
import type { RenderJobAccepted } from './interfaces/render-job-accepted.interface.js';
import type { JobRecord } from './queue/job-record.js';
import { JobStoreService } from './queue/job-store.service.js';
import { RenderQueueService } from './queue/render-queue.service.js';
import { OUTPUT_RELATIVE_PATH } from './rendering/hyperframes-runner.service.js';

@Injectable()
export class RenderJobsService {
  constructor(
    private readonly queue: RenderQueueService,
    private readonly store: JobStoreService,
  ) {}

  async accept(dto: CreateRenderJobDto): Promise<RenderJobAccepted> {
    const record = await this.queue.enqueue(dto);
    return { job_id: record.job_id, status: 'queued', ai_model_used: record.ai_model_used };
  }

  async getStatus(jobId: string): Promise<JobRecord> {
    const record = await this.store.read(jobId);
    if (!record) throw new NotFoundException(`No existe el job ${jobId}`);
    return record;
  }

  /** El mp4 solo se sirve cuando el job está `done`. */
  async getVideo(jobId: string): Promise<StreamableFile> {
    const record = await this.getStatus(jobId);
    if (record.status !== 'done') {
      throw new ConflictException(`El job ${jobId} está en estado "${record.status}"; el vídeo solo existe en "done"`);
    }
    const videoPath = path.join(this.store.jobDir(jobId), OUTPUT_RELATIVE_PATH);
    const info = await stat(videoPath).catch(() => null);
    if (!info?.isFile()) throw new NotFoundException(`El job ${jobId} está "done" pero no se encuentra su vídeo`);
    return new StreamableFile(createReadStream(videoPath), {
      type: 'video/mp4',
      length: info.size,
      disposition: `inline; filename="${jobId}.mp4"`,
    });
  }
}

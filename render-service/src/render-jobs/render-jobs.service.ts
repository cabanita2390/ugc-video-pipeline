import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { CreateRenderJobDto } from './dto/create-render-job.dto.js';
import type { RenderJobAccepted } from './interfaces/render-job-accepted.interface.js';

@Injectable()
export class RenderJobsService {
  private readonly logger = new Logger(RenderJobsService.name);

  /** Por ahora solo valida y registra el job. El render llega en un paso posterior. */
  accept(dto: CreateRenderJobDto): RenderJobAccepted {
    const job_id = randomUUID();
    this.logger.log(
      JSON.stringify({
        event: 'render_job_accepted',
        job_id,
        ai_model_used: dto.ai_model_used,
        hook: dto.script.hook,
        alignment_characters: dto.alignment.characters.length,
        audio_base64_chars: dto.audio_base64.length,
      }),
    );
    return { job_id, status: 'accepted', ai_model_used: dto.ai_model_used };
  }
}

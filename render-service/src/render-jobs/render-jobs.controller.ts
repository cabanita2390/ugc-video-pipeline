import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { CreateRenderJobDto } from './dto/create-render-job.dto';
import type { RenderJobAccepted } from './interfaces/render-job-accepted.interface';
import { RenderJobsService } from './render-jobs.service';

@Controller('render-jobs')
export class RenderJobsController {
  constructor(private readonly renderJobsService: RenderJobsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Body() dto: CreateRenderJobDto): RenderJobAccepted {
    return this.renderJobsService.accept(dto);
  }
}

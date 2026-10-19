import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, StreamableFile } from '@nestjs/common';
import { CreateRenderJobDto } from './dto/create-render-job.dto.js';
import type { RenderJobAccepted } from './interfaces/render-job-accepted.interface.js';
import type { JobRecord } from './queue/job-record.js';
import { RenderJobsService } from './render-jobs.service.js';

const jobIdPipe = new ParseUUIDPipe({ version: '4' });

@Controller('render-jobs')
export class RenderJobsController {
  constructor(private readonly renderJobsService: RenderJobsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  create(@Body() dto: CreateRenderJobDto): Promise<RenderJobAccepted> {
    return this.renderJobsService.accept(dto);
  }

  @Get(':id')
  getStatus(@Param('id', jobIdPipe) id: string): Promise<JobRecord> {
    return this.renderJobsService.getStatus(id);
  }

  @Get(':id/video')
  getVideo(@Param('id', jobIdPipe) id: string): Promise<StreamableFile> {
    return this.renderJobsService.getVideo(id);
  }
}

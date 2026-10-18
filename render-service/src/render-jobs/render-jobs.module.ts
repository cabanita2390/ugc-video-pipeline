import { Module } from '@nestjs/common';
import { RenderJobsController } from './render-jobs.controller.js';
import { RenderJobsService } from './render-jobs.service.js';

@Module({
  controllers: [RenderJobsController],
  providers: [RenderJobsService],
})
export class RenderJobsModule {}

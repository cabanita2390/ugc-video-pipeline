import { Module } from '@nestjs/common';
import { RenderJobsController } from './render-jobs.controller';
import { RenderJobsService } from './render-jobs.service';

@Module({
  controllers: [RenderJobsController],
  providers: [RenderJobsService],
})
export class RenderJobsModule {}

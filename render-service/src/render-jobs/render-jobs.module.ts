import { Module } from '@nestjs/common';
import { RenderJobsController } from './render-jobs.controller.js';
import { RenderJobsService } from './render-jobs.service.js';
import { JobStoreService } from './queue/job-store.service.js';
import { RenderQueueService } from './queue/render-queue.service.js';
import { FfprobeService } from './rendering/ffprobe.service.js';
import { HyperframesRunnerService } from './rendering/hyperframes-runner.service.js';
import { JobWorkspaceService } from './rendering/job-workspace.service.js';
import { ProcessTreeService } from './rendering/process-tree.service.js';
import { RENDER_CONFIG, loadRenderConfig } from './rendering/render-config.js';

@Module({
  controllers: [RenderJobsController],
  providers: [
    RenderJobsService,
    { provide: RENDER_CONFIG, useFactory: () => loadRenderConfig() },
    JobStoreService,
    RenderQueueService,
    FfprobeService,
    ProcessTreeService,
    JobWorkspaceService,
    HyperframesRunnerService,
  ],
})
export class RenderJobsModule {}

import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { RenderJobsModule } from './render-jobs/render-jobs.module.js';

@Module({
  imports: [RenderJobsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

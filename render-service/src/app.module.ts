import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RenderJobsModule } from './render-jobs/render-jobs.module';

@Module({
  imports: [RenderJobsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

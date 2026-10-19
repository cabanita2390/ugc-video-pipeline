import { Inject, Injectable } from '@nestjs/common';
import { RENDER_CONFIG, type RenderConfig } from './render-config.js';
import { runCommand } from './run-command.js';

const FFPROBE_TIMEOUT_MS = 15_000;

@Injectable()
export class FfprobeService {
  constructor(@Inject(RENDER_CONFIG) private readonly config: RenderConfig) {}

  /** Duración del contenedor en segundos (`format=duration`). */
  async getDurationSeconds(filePath: string): Promise<number> {
    const { code, stdout, stderr } = await runCommand(
      this.config.ffprobePath,
      ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath],
      FFPROBE_TIMEOUT_MS,
    );
    if (code !== 0) {
      throw new Error(`ffprobe salió con código ${String(code)}: ${stderr.trim()}`);
    }
    const duration = Number(stdout.trim());
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`ffprobe no devolvió una duración válida: "${stdout.trim()}"`);
    }
    return duration;
  }
}

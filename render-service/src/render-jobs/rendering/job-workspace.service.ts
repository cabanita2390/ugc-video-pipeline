import { Inject, Injectable, Logger } from '@nestjs/common';
import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { groupCharactersIntoWords } from '../alignment/group-characters-into-words.js';
import type { CreateRenderJobDto } from '../dto/create-render-job.dto.js';
import { FfprobeService } from './ffprobe.service.js';
import { type JobLogContext, logJobEvent } from './job-log-context.js';
import { RENDER_CONFIG, type RenderConfig } from './render-config.js';

/** Ruta FIJA del audio dentro de la plantilla (el `src` del `<audio>` no puede venir de una variable). */
export const VOICE_RELATIVE_PATH = path.join('assets', 'voice.mp3');
export const VARIABLES_FILE = 'variables.json';

const JOB_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
/** Etiqueta de apertura del root de la composición (`<div id="root" ...>`). */
const ROOT_TAG_PATTERN = /<div\b[^>]*\bid="root"[^>]*>/g;
const DATA_DURATION_PATTERN = /\bdata-duration="[^"]*"/;

export interface PreparedJob {
  jobDir: string;
  durationSeconds: number;
  wordCount: number;
}

/** Variables que acepta la plantilla (`data-composition-variables` de templates/ugc/index.html). */
interface TemplateVariables {
  hook: string;
  words: string;
  ai_model_used: string;
  accent?: string;
}

@Injectable()
export class JobWorkspaceService {
  private readonly logger = new Logger(JobWorkspaceService.name);

  constructor(
    @Inject(RENDER_CONFIG) private readonly config: RenderConfig,
    private readonly ffprobe: FfprobeService,
  ) {}

  /** Deja `<JOBS_DIR>/<jobId>/` listo para `hyperframes render`. Falla si el job ya fue preparado. */
  async prepare(jobId: string, dto: CreateRenderJobDto): Promise<PreparedJob> {
    if (!JOB_ID_PATTERN.test(jobId)) {
      throw new Error(`jobId inválido para una carpeta: "${jobId}"`);
    }
    const ctx: JobLogContext = { job_id: jobId, ai_model_used: dto.ai_model_used };
    const jobDir = path.join(this.config.jobsDir, jobId);

    // La carpeta puede existir ya (la cola escribe job.json al encolar); la plantilla no.
    await mkdir(jobDir, { recursive: true });
    if (await pathExists(path.join(jobDir, 'index.html'))) {
      throw new Error(`El job ${jobId} ya fue preparado`);
    }
    await cp(this.config.templateDir, jobDir, { recursive: true });
    logJobEvent(this.logger, ctx, 'workspace_created', { job_dir: jobDir });

    const audio = Buffer.from(dto.audio_base64, 'base64');
    if (audio.length === 0) {
      throw new Error('audio_base64 decodifica a 0 bytes');
    }
    const audioPath = path.join(jobDir, VOICE_RELATIVE_PATH);
    await writeFile(audioPath, audio);
    logJobEvent(this.logger, ctx, 'audio_written', { audio_bytes: audio.length });

    const durationSeconds = await this.ffprobe.getDurationSeconds(audioPath);
    logJobEvent(this.logger, ctx, 'audio_probed', { duration_seconds: durationSeconds });

    const indexPath = path.join(jobDir, 'index.html');
    const html = await readFile(indexPath, 'utf8');
    await writeFile(indexPath, setRootDuration(html, durationSeconds));
    logJobEvent(this.logger, ctx, 'root_duration_set', { data_duration: formatDuration(durationSeconds) });

    const words = groupCharactersIntoWords(dto.alignment);
    const variables: TemplateVariables = {
      hook: dto.script.hook,
      words: JSON.stringify(words),
      ai_model_used: dto.ai_model_used,
      ...(dto.accent !== undefined && { accent: dto.accent }),
    };
    await writeFile(path.join(jobDir, VARIABLES_FILE), JSON.stringify(variables, null, 2));
    logJobEvent(this.logger, ctx, 'variables_written', {
      word_count: words.length,
      accent: variables.accent ?? null,
    });

    return { jobDir, durationSeconds, wordCount: words.length };
  }
}

async function pathExists(p: string): Promise<boolean> {
  return access(p).then(
    () => true,
    () => false,
  );
}

/** Milisegundos redondeados hacia arriba, para no cortar el final del audio. */
export function formatDuration(seconds: number): string {
  return String(Math.ceil(seconds * 1000) / 1000);
}

/**
 * `data-duration` del root se fija en compile (spike/NOTES.md): hay que escribirlo en el HTML.
 * Exige exactamente un root con `data-duration`; si la plantilla cambia, falla en vez de adivinar.
 */
export function setRootDuration(html: string, seconds: number): string {
  const roots = html.match(ROOT_TAG_PATTERN) ?? [];
  if (roots.length !== 1 || !DATA_DURATION_PATTERN.test(roots[0])) {
    throw new Error('La plantilla debe tener un único <div id="root"> con data-duration');
  }
  const rootTag = roots[0];
  const patched = rootTag.replace(DATA_DURATION_PATTERN, `data-duration="${formatDuration(seconds)}"`);
  return html.replace(rootTag, () => patched);
}

import path from 'node:path';

export const RENDER_CONFIG = Symbol('RENDER_CONFIG');

export interface RenderConfig {
  /** Carpeta base de los jobs (`JOBS_DIR`, por defecto `./jobs`), absoluta. */
  jobsDir: string;
  /** Plantilla Hyperframes que se copia en cada job. */
  templateDir: string;
  /** `--workers` del CLI (`RENDER_WORKERS`, por defecto 4). Ver spike/NOTES.md. */
  workers: number;
  /** Binario de ffprobe: el mismo override que usa el CLI de Hyperframes. */
  ffprobePath: string;
}

/** src/render-jobs/rendering → raíz de render-service (igual desde dist/render-jobs/rendering). */
const SERVICE_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

export function loadRenderConfig(env: NodeJS.ProcessEnv = process.env): RenderConfig {
  const workersRaw = env.RENDER_WORKERS ?? '4';
  const workers = Number(workersRaw);
  if (!Number.isInteger(workers) || workers < 1) {
    throw new Error(`RENDER_WORKERS debe ser un entero >= 1 (recibido: "${workersRaw}")`);
  }
  return {
    jobsDir: path.resolve(env.JOBS_DIR ?? 'jobs'),
    templateDir: path.join(SERVICE_ROOT, 'templates', 'ugc'),
    workers,
    ffprobePath: env.HYPERFRAMES_FFPROBE_PATH ?? 'ffprobe',
  };
}

import { Inject, Injectable, Logger } from '@nestjs/common';
import { spawn } from 'node:child_process';
import { stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { type JobLogContext, logJobError, logJobEvent } from './job-log-context.js';
import { ProcessTreeService } from './process-tree.service.js';
import { RENDER_CONFIG, type RenderConfig } from './render-config.js';
import { VARIABLES_FILE } from './job-workspace.service.js';

export const OUTPUT_RELATIVE_PATH = path.join('renders', 'out.mp4');

/** `npx` es `npx.cmd` en Windows y no se puede lanzar sin shell: se ejecuta el `.mjs` con node. */
const CLI_BIN = path.join(
  path.dirname(createRequire(import.meta.url).resolve('hyperframes/package.json')),
  'bin',
  'hyperframes.mjs',
);
const PROGRESS_PREFIX = '@hf-progress ';
const OUTPUT_TAIL_LINES = 30;
/** Tras `kill()`, cuánto se espera al evento `exit` antes de buscar huérfanos. */
const KILL_GRACE_MS = 5_000;

export interface RenderResult {
  outputPath: string;
  elapsedMs: number;
}

export class HyperframesRenderError extends Error {
  constructor(
    readonly exitCode: number | null,
    readonly signal: NodeJS.Signals | null,
    readonly outputTail: string[],
  ) {
    super(
      `hyperframes render falló (código ${String(exitCode)}, señal ${String(signal)}):\n${outputTail.join('\n')}`,
    );
    this.name = 'HyperframesRenderError';
  }
}

export interface OrphanReport {
  /** Descendientes del CLI vivos tras matarlo. */
  found: string[];
  /** Los que seguían vivos después de `taskkill /T /F`. */
  remaining: string[];
}

export class HyperframesTimeoutError extends Error {
  constructor(
    readonly timeoutMs: number,
    readonly orphans: OrphanReport | null,
    readonly outputTail: string[],
  ) {
    super(`hyperframes render superó el timeout de ${timeoutMs} ms`);
    this.name = 'HyperframesTimeoutError';
  }
}

/** Timeout del job: 30 s fijos + 10 s por segundo de vídeo (spike/NOTES.md). */
export function renderTimeoutMs(durationSeconds: number): number {
  return Math.ceil((30 + 10 * durationSeconds) * 1000);
}

export function buildRenderArgs(workers: number): string[] {
  return [
    CLI_BIN,
    'render',
    '.',
    '--quality',
    'looks',
    '--variables-file',
    VARIABLES_FILE,
    '--strict-variables',
    '--workers',
    String(workers),
    '--output',
    OUTPUT_RELATIVE_PATH,
  ];
}

@Injectable()
export class HyperframesRunnerService {
  private readonly logger = new Logger(HyperframesRunnerService.name);

  constructor(
    @Inject(RENDER_CONFIG) private readonly config: RenderConfig,
    private readonly processTree: ProcessTreeService,
  ) {}

  run(jobDir: string, durationSeconds: number, ctx: JobLogContext): Promise<RenderResult> {
    const timeoutMs = renderTimeoutMs(durationSeconds);
    const args = buildRenderArgs(this.config.workers);
    const started = Date.now();
    const tail: string[] = [];
    const pushTail = (line: string): void => {
      tail.push(line);
      if (tail.length > OUTPUT_TAIL_LINES) tail.shift();
    };

    logJobEvent(this.logger, ctx, 'render_started', {
      job_dir: jobDir,
      workers: this.config.workers,
      timeout_ms: timeoutMs,
      args: args.slice(1),
    });

    return new Promise<RenderResult>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        cwd: jobDir,
        shell: false,
        windowsHide: true,
        env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' },
      });

      let settled = false;
      let exited = false;
      let lastProgressBucket = -1;
      const settle = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn();
      };

      child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (!line) continue;
          const pct = parseProgress(line);
          if (pct === null) {
            pushTail(`[out] ${line}`);
          } else if (Math.floor(pct / 25) > lastProgressBucket) {
            lastProgressBucket = Math.floor(pct / 25);
            logJobEvent(this.logger, ctx, 'render_progress', { pct });
          }
        }
      });
      // stderr lleva los [INFO]/[WARN] del CLI; no indica fallo por sí solo.
      child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
        for (const line of chunk.split(/\r?\n/)) {
          if (line) pushTail(`[err] ${line}`);
        }
      });

      const exitPromise = new Promise<void>((resolveExit) => {
        child.once('exit', () => {
          exited = true;
          resolveExit();
        });
      });

      child.once('error', (err) => {
        settle(() => {
          logJobError(this.logger, ctx, 'render_spawn_error', { error: err.message });
          reject(err);
        });
      });

      child.once('close', (code, signal) => {
        if (settled) return;
        const elapsedMs = Date.now() - started;
        if (code !== 0) {
          settle(() => {
            logJobError(this.logger, ctx, 'render_failed', {
              exit_code: code,
              signal,
              elapsed_ms: elapsedMs,
              output_tail: tail.slice(-10),
            });
            reject(new HyperframesRenderError(code, signal, [...tail]));
          });
          return;
        }
        const outputPath = path.join(jobDir, OUTPUT_RELATIVE_PATH);
        stat(outputPath).then(
          (info) =>
            settle(() => {
              logJobEvent(this.logger, ctx, 'render_finished', {
                output_path: outputPath,
                output_bytes: info.size,
                elapsed_ms: elapsedMs,
              });
              resolve({ outputPath, elapsedMs });
            }),
          () =>
            settle(() => {
              logJobError(this.logger, ctx, 'render_output_missing', { output_path: outputPath });
              reject(new HyperframesRenderError(code, signal, [...tail, `No existe ${outputPath}`]));
            }),
        );
      });

      const timer = setTimeout(() => {
        settled = true; // a partir de aquí solo este camino rechaza.
        logJobError(this.logger, ctx, 'render_timeout', { timeout_ms: timeoutMs, pid: child.pid });
        child.kill();
        void this.waitAndReapOrphans(child.pid, exitPromise, () => exited, ctx).then(
          (orphans) => reject(new HyperframesTimeoutError(timeoutMs, orphans, [...tail])),
          (err: unknown) => {
            logJobError(this.logger, ctx, 'orphan_check_failed', { error: String(err) });
            reject(new HyperframesTimeoutError(timeoutMs, null, [...tail]));
          },
        );
      }, timeoutMs);
    });
  }

  /**
   * Windows no mata a los hijos con el padre: tras `kill()` los Chrome del CLI pueden seguir vivos.
   * Se buscan por ParentProcessId (no se reasigna al morir el padre) y se mata cada subárbol.
   */
  private async waitAndReapOrphans(
    pid: number | undefined,
    exitPromise: Promise<void>,
    hasExited: () => boolean,
    ctx: JobLogContext,
  ): Promise<OrphanReport | null> {
    await Promise.race([exitPromise, delay(KILL_GRACE_MS)]);
    logJobEvent(this.logger, ctx, 'render_killed', { pid, exited: hasExited() });
    if (!this.processTree.supported || pid === undefined) return null;

    const orphans = await this.processTree.listDescendants(pid);
    const found = orphans.map(describe);
    logJobEvent(this.logger, ctx, 'orphans_checked', { pid, orphan_count: orphans.length, orphans: found });
    if (orphans.length === 0) return { found, remaining: [] };

    // Padres antes que hijos: /T se lleva el subárbol y los siguientes taskkill fallan sin efecto.
    // Matar cada uno cubre también nietos cuyo padre intermedio ya murió.
    for (const orphan of orphans) {
      await this.processTree.killTree(orphan.pid);
    }
    const remaining = (await this.processTree.stillAlive(orphans)).map(describe);
    logJobEvent(this.logger, ctx, 'orphans_killed', { pid, remaining_count: remaining.length, remaining });
    return { found, remaining };
  }
}

function describe(p: { pid: number; name: string }): string {
  return `${p.name}#${p.pid}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** `@hf-progress {"code":...,"pct":N}` → N; cualquier otra línea → null. */
export function parseProgress(line: string): number | null {
  if (!line.startsWith(PROGRESS_PREFIX)) return null;
  try {
    const parsed: unknown = JSON.parse(line.slice(PROGRESS_PREFIX.length));
    if (typeof parsed === 'object' && parsed !== null && 'pct' in parsed && typeof parsed.pct === 'number') {
      return parsed.pct;
    }
  } catch {
    // línea de progreso malformada: se ignora.
  }
  return null;
}

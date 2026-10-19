import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import {
  HyperframesRenderError,
  HyperframesRunnerService,
  HyperframesTimeoutError,
  OUTPUT_RELATIVE_PATH,
  parseProgress,
  renderTimeoutMs,
} from './hyperframes-runner.service.js';
import type { ProcessInfo, ProcessTreeService } from './process-tree.service.js';
import type { RenderConfig } from './render-config.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

class FakeChild extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly pid = 4242;
  readonly kill = vi.fn(() => {
    this.finish(null, 'SIGTERM');
    return true;
  });

  finish(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit('exit', code, signal);
    this.stdout.end();
    this.stderr.end();
    this.emit('close', code, signal);
  }
}

const ctx = { job_id: 'job-1', ai_model_used: 'meta-llama/llama-3.3-70b-instruct:free' };

function fakeProcessTree(orphans: ProcessInfo[] = [], supported = true) {
  return {
    supported,
    listDescendants: vi.fn((_pid: number): Promise<ProcessInfo[]> => Promise.resolve(orphans)),
    killTree: vi.fn((_pid: number): Promise<boolean> => Promise.resolve(true)),
    stillAlive: vi.fn((_snapshot: ProcessInfo[]): Promise<ProcessInfo[]> => Promise.resolve([])),
  };
}

describe('HyperframesRunnerService', () => {
  const spawnMock = vi.mocked(spawn);
  let child: FakeChild;
  let jobDir: string;
  const config: RenderConfig = { jobsDir: '', templateDir: '', workers: 4, ffprobePath: 'ffprobe' };

  beforeEach(async () => {
    child = new FakeChild();
    spawnMock.mockReset();
    spawnMock.mockReturnValue(child as unknown as ReturnType<typeof spawn>);
    jobDir = await mkdtemp(path.join(os.tmpdir(), 'runner-spec-'));
  });

  afterEach(async () => {
    vi.useRealTimers();
    await rm(jobDir, { recursive: true, force: true });
  });

  function makeRunner(tree = fakeProcessTree()): HyperframesRunnerService {
    return new HyperframesRunnerService(config, tree as unknown as ProcessTreeService);
  }

  it('lanza node + bin de hyperframes sin shell, con los argumentos del spike, y resuelve con el mp4', async () => {
    await mkdir(path.join(jobDir, 'renders'));
    await writeFile(path.join(jobDir, OUTPUT_RELATIVE_PATH), 'mp4');

    const promise = makeRunner().run(jobDir, 6, ctx);
    child.stdout.write('@hf-progress {"code":"capture","pct":50}\nrendered in 24.1s\n');
    child.finish(0);
    const result = await promise;

    expect(result.outputPath).toBe(path.join(jobDir, OUTPUT_RELATIVE_PATH));
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);

    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe(process.execPath);
    expect(args?.[0]).toMatch(/hyperframes[\\/]bin[\\/]hyperframes\.mjs$/);
    expect(args?.slice(1)).toEqual([
      'render',
      '.',
      '--quality',
      'looks',
      '--variables-file',
      'variables.json',
      '--strict-variables',
      '--workers',
      '4',
      '--output',
      OUTPUT_RELATIVE_PATH,
    ]);
    expect(options).toMatchObject({ cwd: jobDir, shell: false });
    expect(options?.env?.HYPERFRAMES_NO_TELEMETRY).toBe('1');
  });

  it('rechaza con HyperframesRenderError si el código de salida no es 0', async () => {
    const promise = makeRunner().run(jobDir, 6, ctx);
    child.stderr.write('[ERROR] Composition failed\n');
    child.finish(1);

    const error = await promise.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HyperframesRenderError);
    expect((error as HyperframesRenderError).exitCode).toBe(1);
    expect((error as HyperframesRenderError).outputTail).toContain('[err] [ERROR] Composition failed');
  });

  it('rechaza si el código es 0 pero no existe el mp4', async () => {
    const promise = makeRunner().run(jobDir, 6, ctx);
    child.finish(0);
    await expect(promise).rejects.toBeInstanceOf(HyperframesRenderError);
  });

  it('en timeout mata el proceso, busca huérfanos y mata su árbol', async () => {
    vi.useFakeTimers();
    const orphans: ProcessInfo[] = [
      { pid: 100, parentPid: 4242, name: 'chrome-headless-shell.exe', createdAt: '1' },
      { pid: 101, parentPid: 100, name: 'chrome-headless-shell.exe', createdAt: '2' },
    ];
    const tree = fakeProcessTree(orphans);
    const promise = makeRunner(tree).run(jobDir, 2, ctx);
    const settled = promise.catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(renderTimeoutMs(2));
    const error = await settled;

    expect(child.kill).toHaveBeenCalledOnce();
    expect(tree.listDescendants).toHaveBeenCalledWith(4242);
    expect(tree.killTree.mock.calls.map(([pid]) => pid)).toEqual([100, 101]);
    expect(error).toBeInstanceOf(HyperframesTimeoutError);
    expect((error as HyperframesTimeoutError).timeoutMs).toBe(50_000);
    expect((error as HyperframesTimeoutError).orphans).toEqual({
      found: ['chrome-headless-shell.exe#100', 'chrome-headless-shell.exe#101'],
      remaining: [],
    });
  });

  it('en timeout sin huérfanos no llama a taskkill', async () => {
    vi.useFakeTimers();
    const tree = fakeProcessTree([]);
    const settled = makeRunner(tree).run(jobDir, 0.5, ctx).catch((e: unknown) => e);

    await vi.advanceTimersByTimeAsync(renderTimeoutMs(0.5));

    expect(await settled).toBeInstanceOf(HyperframesTimeoutError);
    expect(tree.killTree).not.toHaveBeenCalled();
  });
});

describe('renderTimeoutMs', () => {
  it('es 30 s + 10 × duración', () => {
    expect(renderTimeoutMs(6)).toBe(90_000);
    expect(renderTimeoutMs(0)).toBe(30_000);
  });
});

describe('parseProgress', () => {
  it('lee el pct de las líneas @hf-progress e ignora el resto', () => {
    expect(parseProgress('@hf-progress {"code":"capture","pct":37}')).toBe(37);
    expect(parseProgress('@hf-progress {roto')).toBeNull();
    expect(parseProgress('rendered in 24.1s')).toBeNull();
  });
});

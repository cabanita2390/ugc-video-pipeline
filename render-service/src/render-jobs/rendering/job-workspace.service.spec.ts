import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { CreateRenderJobDto } from '../dto/create-render-job.dto.js';
import type { FfprobeService } from './ffprobe.service.js';
import { JobWorkspaceService, formatDuration, setRootDuration } from './job-workspace.service.js';
import { loadRenderConfig, type RenderConfig } from './render-config.js';

const AUDIO_BYTES = Buffer.from('ID3 fake mp3 bytes');

function makeDto(overrides: Partial<CreateRenderJobDto> = {}): CreateRenderJobDto {
  return {
    ai_model_used: 'meta-llama/llama-3.3-70b-instruct:free',
    script: { hook: '3 errores que arruinan tu piel', voiceover: 'Hola, mundo' },
    audio_base64: AUDIO_BYTES.toString('base64'),
    alignment: {
      characters: Array.from('Hola, mundo'),
      character_start_times_seconds: [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
      character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1],
    },
    accent: '#22c55e',
    ...overrides,
  };
}

describe('JobWorkspaceService', () => {
  let jobsDir: string;
  let config: RenderConfig;
  let ffprobe: { getDurationSeconds: ReturnType<typeof vi.fn<(file: string) => Promise<number>>> };
  let service: JobWorkspaceService;

  beforeEach(async () => {
    jobsDir = await mkdtemp(path.join(os.tmpdir(), 'workspace-spec-'));
    config = { ...loadRenderConfig({}), jobsDir };
    ffprobe = { getDurationSeconds: vi.fn(() => Promise.resolve(6.0123)) };
    service = new JobWorkspaceService(config, ffprobe as unknown as FfprobeService);
  });

  afterEach(async () => {
    await rm(jobsDir, { recursive: true, force: true });
  });

  it('copia la plantilla, escribe el audio, fija data-duration y escribe variables.json', async () => {
    const prepared = await service.prepare('job-abc', makeDto());
    const jobDir = path.join(jobsDir, 'job-abc');

    expect(prepared).toEqual({ jobDir, durationSeconds: 6.0123, wordCount: 2 });
    await access(path.join(jobDir, 'assets', 'vendor', 'gsap-3.14.2.min.js'));
    await access(path.join(jobDir, 'hyperframes.json'));

    const audioPath = path.join(jobDir, 'assets', 'voice.mp3');
    expect(await readFile(audioPath)).toEqual(AUDIO_BYTES);
    expect(ffprobe.getDurationSeconds).toHaveBeenCalledWith(audioPath);

    const html = await readFile(path.join(jobDir, 'index.html'), 'utf8');
    expect(html).toMatch(/<div id="root"[^>]*data-duration="6.013"/);
    // Las capas hijas conservan su propio data-duration.
    expect(html).toContain('data-start="0" data-duration="2.5"');

    const variables: unknown = JSON.parse(await readFile(path.join(jobDir, 'variables.json'), 'utf8'));
    expect(variables).toEqual({
      hook: '3 errores que arruinan tu piel',
      words: JSON.stringify([
        { text: 'Hola,', start: 0, end: 0.5 },
        { text: 'mundo', start: 0.6, end: 1.1 },
      ]),
      ai_model_used: 'meta-llama/llama-3.3-70b-instruct:free',
      accent: '#22c55e',
    });
  });

  it('no escribe accent si no viene en el payload', async () => {
    await service.prepare('job-sin-accent', makeDto({ accent: undefined }));
    const raw = await readFile(path.join(jobsDir, 'job-sin-accent', 'variables.json'), 'utf8');
    expect(JSON.parse(raw)).not.toHaveProperty('accent');
  });

  it('falla si el job ya existe', async () => {
    await service.prepare('job-dup', makeDto());
    await expect(service.prepare('job-dup', makeDto())).rejects.toMatchObject({ code: 'EEXIST' });
  });

  it('rechaza jobIds que podrían salirse de JOBS_DIR', async () => {
    await expect(service.prepare('../fuera', makeDto())).rejects.toThrow(/jobId inválido/);
  });

  it('propaga el error de ffprobe', async () => {
    ffprobe.getDurationSeconds.mockRejectedValueOnce(new Error('ffprobe salió con código 1'));
    await expect(service.prepare('job-ffprobe', makeDto())).rejects.toThrow(/ffprobe/);
  });
});

describe('setRootDuration', () => {
  it('solo cambia el data-duration del root', () => {
    const html = '<div id="root" data-duration="6"><h1 class="clip" data-duration="2.5"></h1></div>';
    expect(setRootDuration(html, 12.3456)).toBe(
      '<div id="root" data-duration="12.346"><h1 class="clip" data-duration="2.5"></h1></div>',
    );
  });

  it('falla si no hay root con data-duration', () => {
    expect(() => setRootDuration('<div id="root"></div>', 3)).toThrow(/data-duration/);
    expect(() => setRootDuration('<main></main>', 3)).toThrow(/data-duration/);
  });
});

describe('formatDuration', () => {
  it('redondea hacia arriba al milisegundo', () => {
    expect(formatDuration(6)).toBe('6');
    expect(formatDuration(6.0001)).toBe('6.001');
  });
});

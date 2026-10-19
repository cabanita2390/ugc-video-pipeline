import { Injectable } from '@nestjs/common';
import { runCommand } from './run-command.js';

const COMMAND_TIMEOUT_MS = 20_000;

export interface ProcessInfo {
  pid: number;
  parentPid: number;
  name: string;
  /** FILETIME UTC de creación: distingue un proceso de otro que reutilice el mismo PID. */
  createdAt: string;
}

/**
 * Árbol de procesos en Windows. Matar al hijo directo (el CLI de Node) no mata a los Chrome
 * que lanzó: ver render-service/NOTES-RENDER.md.
 */
@Injectable()
export class ProcessTreeService {
  readonly supported = process.platform === 'win32';

  /** Todos los descendientes de `rootPid` (sin incluirlo). */
  async listDescendants(rootPid: number): Promise<ProcessInfo[]> {
    const all = await this.listAll();
    const byParent = new Map<number, ProcessInfo[]>();
    for (const p of all) {
      const siblings = byParent.get(p.parentPid) ?? [];
      siblings.push(p);
      byParent.set(p.parentPid, siblings);
    }
    const result: ProcessInfo[] = [];
    const pending = [rootPid];
    const seen = new Set<number>([rootPid]);
    for (let parent = pending.pop(); parent !== undefined; parent = pending.pop()) {
      for (const child of byParent.get(parent) ?? []) {
        if (seen.has(child.pid)) continue;
        seen.add(child.pid);
        result.push(child);
        pending.push(child.pid);
      }
    }
    return result;
  }

  /** De `snapshot`, los que siguen vivos (mismo PID y misma hora de creación). */
  async stillAlive(snapshot: ProcessInfo[]): Promise<ProcessInfo[]> {
    if (snapshot.length === 0) return [];
    const alive = new Map((await this.listAll()).map((p) => [p.pid, p.createdAt]));
    return snapshot.filter((p) => alive.get(p.pid) === p.createdAt);
  }

  /** `taskkill /PID <pid> /T /F`. Devuelve false si taskkill falla (p. ej. el proceso ya terminó). */
  async killTree(pid: number): Promise<boolean> {
    const { code } = await runCommand('taskkill', ['/PID', String(pid), '/T', '/F'], COMMAND_TIMEOUT_MS);
    return code === 0;
  }

  private async listAll(): Promise<ProcessInfo[]> {
    const script =
      'Get-CimInstance Win32_Process | ForEach-Object { "{0}`t{1}`t{2}`t{3}" -f ' +
      '$_.ProcessId, $_.ParentProcessId, $_.CreationDate.ToFileTimeUtc(), $_.Name }';
    const { code, stdout, stderr } = await runCommand(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      COMMAND_TIMEOUT_MS,
    );
    if (code !== 0) {
      throw new Error(`No se pudo listar procesos (código ${String(code)}): ${stderr.trim()}`);
    }
    return parseProcessList(stdout);
  }
}

export function parseProcessList(stdout: string): ProcessInfo[] {
  const result: ProcessInfo[] = [];
  for (const line of stdout.split(/\r?\n/)) {
    const [pid, parentPid, createdAt, ...name] = line.split('\t');
    if (name.length === 0) continue;
    result.push({
      pid: Number(pid),
      parentPid: Number(parentPid),
      createdAt,
      name: name.join('\t'),
    });
  }
  return result;
}

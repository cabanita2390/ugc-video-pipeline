// Spike: invoke the Hyperframes CLI the way render-service will (spawn, no shell, isolated cwd, timeout).
// Usage: node spawn-render.mjs <jobDir> [quality] [workers]
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const cliBin = path.join(path.dirname(require.resolve("hyperframes/package.json")), "bin", "hyperframes.mjs");

const jobDir = path.resolve(process.argv[2]);
const quality = process.argv[3] ?? "looks";
const workers = process.argv[4];
const args = [cliBin, "render", ".", "--quality", quality, "--variables-file", "variables.json", "--strict-variables", "--output", "renders/out.mp4"];
if (workers) args.push("--workers", workers);

const started = Date.now();
const child = spawn(process.execPath, args, {
  cwd: jobDir,
  shell: false,
  timeout: 5 * 60 * 1000,
  env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: "1" },
});

let stdoutProgress = 0;
let stderrProgress = 0;
let stdoutLines = 0;
let stderrLines = 0;
const workerCounts = new Set();
const tail = [];
child.stdout.setEncoding("utf8").on("data", (chunk) => {
  for (const line of chunk.split(/\r?\n/)) {
    if (!line) continue;
    stdoutLines++;
    if (line.startsWith("@hf-progress")) stdoutProgress++;
    tail.push("[out] " + line);
  }
});
child.stderr.setEncoding("utf8").on("data", (chunk) => {
  for (const line of chunk.split(/\r?\n/)) {
    if (!line) continue;
    stderrLines++;
    if (line.startsWith("@hf-progress")) stderrProgress++;
    for (const m of line.matchAll(/"workerCount":(\d+)/g)) workerCounts.add(Number(m[1]));
  }
});
child.on("close", (code, signal) => {
  console.log(JSON.stringify({ workers: workers ?? "auto", code, signal, wallSeconds: (Date.now() - started) / 1000, workerCounts: [...workerCounts], stdoutProgress, stderrProgress }));
  console.log(tail.slice(-2).join("\n"));
});

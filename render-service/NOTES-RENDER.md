# Preparación y ejecución del render

Fecha: 2026-10-18 · Windows 11 · Node v22.23.2 · hyperframes 0.8.169 · CPU i5-1135G7 (8 hilos).
Actualizado el 2026-10-19 con la cola y los endpoints de consulta. Ver [Cola y endpoints](#cola-y-endpoints).

## Qué se añadió

- `hyperframes@0.8.169` como dependencia de producción, con versión exacta igual que en `spike/package.json`. El render-service lo ejecuta en runtime.
- `templates/ugc/`: copia de `spike/ugc-template/` sin `assets/voice.mp3`. El audio lo escribe cada job.
- En `src/render-jobs/rendering/`:

| Archivo | Responsabilidad |
| --- | --- |
| `render-config.ts` | Lee `JOBS_DIR` (por defecto `./jobs`, resuelto contra el cwd), `RENDER_WORKERS` (por defecto 4; falla al arrancar si no es un entero ≥ 1) y `HYPERFRAMES_FFPROBE_PATH` (por defecto `ffprobe`). Localiza `templates/ugc` desde `import.meta.dirname`: sube 3 niveles, lo que funciona igual desde `src/` y desde `dist/`. Se inyecta con el token `RENDER_CONFIG`. |
| `run-command.ts` | `spawn` sin shell para comandos cortos (ffprobe, powershell, taskkill). Devuelve código, stdout y stderr. |
| `ffprobe.service.ts` | Obtiene la duración con `ffprobe -show_entries format=duration` (timeout de 15 s). Falla si el código no es 0 o si la duración no es > 0. |
| `job-workspace.service.ts` | `prepare(jobId, dto)`: crea `<JOBS_DIR>/<jobId>/` desde la plantilla y escribe `assets/voice.mp3`. Luego obtiene la duración con ffprobe, reescribe `data-duration` del root y escribe `variables.json`. |
| `hyperframes-runner.service.ts` | `run(jobDir, durationSeconds, ctx)`: lanza el CLI, aplica el timeout y, si vence, busca y mata huérfanos. |
| `process-tree.service.ts` | Solo Windows: lista descendientes (`Get-CimInstance Win32_Process`), comprueba si siguen vivos y ejecuta `taskkill /PID <pid> /T /F`. |
| `job-log-context.ts` | Logs JSON con `event`, `job_id` y `ai_model_used` en cada línea. |

## Decisiones

- **`run()` recibe un tercer argumento, `ctx` (`job_id` y `ai_model_used`).** La firma pedida era `run(jobDir, durationSeconds)`, pero la regla de AUDITORÍA exige `ai_model_used` en cada log, y el runner no tiene otra forma de conocerlo.
- **Validación de `jobId`:** `^[A-Za-z0-9_-]{1,64}$`. Evita que el id salga de `JOBS_DIR` (`../x`). La carpeta del job puede existir ya, porque la cola escribe `job.json` al encolar. Si ya contiene `index.html`, `prepare()` falla con "ya fue preparado" y nunca pisa un job.
- **`data-duration`:** se redondea **hacia arriba** al milisegundo (`6.0123` → `6.013`) para no cortar el final del audio.
  - Solo se cambia en la etiqueta `<div id="root">`. Las capas hijas conservan su propio `data-duration`.
  - Si la plantilla no tiene exactamente un root con `data-duration`, falla en vez de adivinar.
- **`variables.json`:** `hook`, `words` (string JSON de `groupCharactersIntoWords`), `ai_model_used` y `accent`, este último solo si viene. Con `--strict-variables` no se puede enviar ninguna clave que la plantilla no declare.
- **Si `prepare()` falla a mitad, la carpeta del job no se borra.** Así se puede inspeccionar. La limpieza le tocará a la cola.
- **Argumentos del CLI:** `process.execPath <hyperframes>/bin/hyperframes.mjs render . --quality looks --variables-file variables.json --strict-variables --workers <RENDER_WORKERS> --output renders/out.mp4`.
  - Se lanza con `cwd` = jobDir, `shell: false`, `windowsHide: true` y `HYPERFRAMES_NO_TELEMETRY=1`.
  - El bin se resuelve con `createRequire(import.meta.url).resolve('hyperframes/package.json')`.
- **Timeout propio (`setTimeout`), no la opción `timeout` de `spawn`.** Así se controla la secuencia completa: `kill()`, esperar al evento `exit` (máximo 5 s), buscar huérfanos y matarlos. Fórmula: `30 s + 10 s × duración`, es decir 90 s para un vídeo de 6 s.
- **Éxito:** código 0 **y** que exista `renders/out.mp4`. Si el código es 0 pero falta el mp4, también se rechaza.
- **Errores:**
  - `HyperframesRenderError` lleva `exitCode`, `signal` y las últimas 30 líneas de stdout/stderr.
  - `HyperframesTimeoutError` lleva `timeoutMs`, `orphans` (`found` y `remaining`) y esas mismas líneas.
- **Progreso:** las líneas `@hf-progress` se registran solo cuando el porcentaje cruza un tramo de 25 % (`render_progress`), para no llenar el log con ~29 líneas por render.
- **Eventos de log:**
  - Workspace: `workspace_created`, `audio_written`, `audio_probed`, `root_duration_set`, `variables_written`.
  - Runner: `render_started`, `render_progress`, `render_finished`, `render_failed`, `render_output_missing`, `render_spawn_error`.
  - Timeout: `render_timeout`, `render_killed`, `orphans_checked`, `orphans_killed`, `orphan_check_failed`.

## Hallazgos sobre procesos huérfanos (Windows)

Para medirlo usé un script de diagnóstico temporal (no commiteado). Lanza el CLI como el runner, toma una foto del árbol de procesos y hace `kill()` en distintas fases:

| `kill()` a los… | Fase | Descendientes antes del kill | Vivos tras el kill |
| --- | --- | --- | --- |
| ~11 s | captura | 4 `chrome-headless-shell` directos (20 en total) + 5 `conhost` | **0** (en la 1.ª comprobación, ≤ 2,3 s) |
| ~19 s | captura | 20 `chrome-headless-shell` + 7 `conhost` + 2 `tasklist` | **0** (≤ 1,9 s) |
| ~25 s | encode | 1 `ffmpeg` + 2 `conhost` | **0** (≤ 1,8 s) |
| ~28 s | ya había terminado | — | — |

Además:
- En el timeout forzado del runner (8 s), `orphans_checked` encontró 0 huérfanos.
- Después de todas las pruebas, `Get-Process chrome-headless-shell,ffmpeg` daba 0.
- `exit` y `close` del hijo llegan unos 30 ms después de `kill()`: los Chrome no retienen los pipes de stdio.

**Conclusión:** con hyperframes 0.8.169, matar el proceso Node del CLI hace que sus Chrome y su ffmpeg terminen solos en menos de ~2 s. **No reproduje huérfanos.**

Lo mismo pasa un nivel más arriba: al matar la app NestJS a mitad de render, el CLI y sus 24 Chrome desaparecen en menos de 1,5 s (ver [Cola y endpoints](#cola-y-endpoints)).

La explicación más probable, que **no verifiqué en el código de libuv**: en Windows, libuv mete a los hijos de `spawn` en un Job Object con `KILL_ON_JOB_CLOSE`, así que al morir un proceso Node se van todos sus descendientes. Si alguna vez se usa `detached: true`, esto deja de cumplirse.

Aun así, la búsqueda y el `taskkill /T /F` se quedan como red de seguridad:
- Solo corren cuando vence el timeout.
- Cuestan ~2–3 s, por el `Get-CimInstance`.
- Protegen ante cambios de versión del CLI o de Chrome.

Detalles de implementación:
- Los descendientes se buscan por `ParentProcessId`, que en Windows no se reasigna cuando muere el padre.
- Se mata cada huérfano, padres primero. Eso cubre también nietos cuyo padre intermedio ya murió.
- `stillAlive` compara PID **y** hora de creación, para no confundir un PID reutilizado.
- El CLI lanza `tasklist.exe` durante el render, seguramente para vigilar la memoria. Es inofensivo.

## Prueba real

Script temporal en el scratchpad (no commiteado):
- Construye un `CreateRenderJobDto` con `spike/ugc-template/assets/voice.mp3` (6,0 s) y la alineación por carácter reconstruida a partir de las palabras de `spike/jobs/sample-variables.json`.
- Ejecuta `prepare()` + `run()` con los servicios compilados (`dist/`) y `JOBS_DIR` en el scratchpad.

Resultado:
- **Mp4:** H.264 **1080x1920** a 30 fps + AAC, **6,0 s**, igual que el audio (ffprobe). 377 KB.
- **Tiempos:**
  - `prepare()`: 160 ms (copia de plantilla + ffprobe ~0,1 s).
  - `run()`: **31,5 s** con `--workers 4`. En el spike, el mismo vídeo de 6 s tardó 29,4–29,7 s (`spawn-render.mjs`).
  - Total: 31,7 s.
- **Frames revisados:**
  - A 2,0 s se ve el hook "3 errores que arruinan tu piel" y el subtítulo "CARA" (1,8–2,4 s).
  - A 5,0 s, el hook ya no está y aparece "SERIO" (4,7–5,6 s).

## Tests (vitest)

- **`hyperframes-runner.service.spec.ts`** mockea `node:child_process` con `vi.mock` y usa un `FakeChild` (EventEmitter + PassThrough). Casos:
  - Éxito: verifica el comando, los argumentos exactos, `cwd`, `shell: false` y `HYPERFRAMES_NO_TELEMETRY`.
  - Código de salida 1.
  - Código 0 sin mp4.
  - Timeout con huérfanos (fake timers): `kill`, `listDescendants` y `taskkill` sobre cada huérfano.
  - Timeout sin huérfanos.
  - También cubre `renderTimeoutMs` y `parseProgress`.
- **`job-workspace.service.spec.ts`** usa una carpeta temporal real, la plantilla real de `templates/ugc` y ffprobe mockeado. Casos:
  - Archivos copiados.
  - Bytes del audio.
  - `data-duration` del root sin tocar las capas hijas.
  - `variables.json` exacto, con y sin `accent`.
  - Carpeta ya creada (con `job.json`) que se acepta, job ya preparado, jobId inválido y error de ffprobe.
  - También cubre `setRootDuration` y `formatDuration`.

## Cola y endpoints

### Flujo
1. `POST /render-jobs` valida el DTO, genera un `job_id` (UUID v4) y escribe `jobs/<job_id>/job.json` en `queued`. Lo encola y responde **202** `{ job_id, status: 'queued', ai_model_used }` sin esperar al render (26 ms en la prueba real).
2. `RenderQueueService` es una cola en memoria con **concurrencia 1**: un único `drain()` procesa los jobs en orden.
3. Para cada job, el worker hace:
   - `rendering` + `started_at`;
   - `JobWorkspaceService.prepare`;
   - `duration_seconds`;
   - `HyperframesRunnerService.run`;
   - `done` + `finished_at` + `render_ms`.
4. Si falla, el job queda en `failed` con `finished_at` y `error`. `error` es la primera línea del mensaje, como máximo 300 caracteres; el detalle completo va al log.
5. Un fallo no detiene la cola: sigue con el siguiente job.
6. Al arrancar (`onModuleInit`, antes de aceptar peticiones), los `job.json` en `queued` o `rendering` pasan a `failed` con `error: 'interrupted by restart'`.

### `job.json` (`JobStoreService`)
- Campos: `job_id`, `status` (`queued|rendering|done|failed`), `ai_model_used`, `hook`, `created_at`, `started_at`, `finished_at`, `duration_seconds`, `render_ms`, `error`.
  - Las fechas van en ISO UTC.
  - Lo que aún no aplica va a `null`, no se omite.
- Es la fuente de verdad: `GET` lee siempre del disco, no de memoria.
- **Escritura atómica:** `job.json.<uuid>.tmp` + `rename`.
  - En Windows, `rename` sobre un archivo existente lo reemplaza.
  - Se reintenta hasta 5 veces ante `EPERM`/`EBUSY`/`EACCES` (antivirus o un lector abierto) y se borra el temporal si falla.
- `read` valida la forma mínima (`job_id`, `status` válido, `ai_model_used`, `created_at`). Si no cuadra, falla en vez de devolver basura.

### Endpoints
| Endpoint | Respuesta |
| --- | --- |
| `POST /render-jobs` | 202 `{ job_id, status: 'queued', ai_model_used }` · 400 si el DTO es inválido |
| `GET /render-jobs/:id` | 200 con el `job.json` · 404 si no existe · 400 si `id` no es UUID v4 (`ParseUUIDPipe`) |
| `GET /render-jobs/:id/video` | 200 `video/mp4` (`StreamableFile`, con `Content-Length` y `Content-Disposition: inline`) solo si está `done` · 409 si está `queued`, `rendering` o `failed` · 404 si no existe, o si está `done` sin mp4 · 400 si el id es inválido |

El `ParseUUIDPipe` además impide que el id salga de `JOBS_DIR`.

### Otras decisiones
- **`configureApp()`** (`src/configure-app.ts`): body parser de 10 MB + `ValidationPipe`. Lo usan `main.ts` y los e2e, así ya no se duplica.
- **El payload completo, con el audio en base64 (hasta ~10 MB), vive en memoria** mientras el job está `queued`. Con concurrencia 1 y muchos jobs en espera, la memoria crece. Si eso pesa, el audio se puede escribir a disco al encolar.
- **Eventos de log de la cola:** `job_queued`, `job_status_changed` (from/to), `job_started`, `job_done`, `job_failed`, `job_record_write_failed` y `job_interrupted_by_restart`. Todos llevan `job_id` y `ai_model_used`.

### Tests
- **`job-store.service.spec.ts`** (carpeta temporal):
  - Escritura sin temporales residuales.
  - `read` con `null` y con formato inválido.
  - `failInterrupted` sobre queued/rendering/done/failed y sobre una carpeta sin `job.json`.
  - `JOBS_DIR` inexistente.
- **`render-queue.service.spec.ts`** (carpeta temporal + workspace/runner falsos con deferreds):
  - Concurrencia 1: el segundo job sigue `queued` y su `prepare` no se llama hasta que termina el primero.
  - Transiciones queued → rendering → done con `job.json` completo.
  - Fallo de `run` → `failed` con error corto, y la cola continúa.
  - Fallo de `prepare`.
  - Recuperación tras reinicio.
- **e2e** (`test/support/create-test-app.ts`): AppModule real con `JOBS_DIR` temporal y `JobWorkspaceService`/`HyperframesRunnerService` reemplazados por falsos que terminan bien, fallan o se quedan colgados. **No se lanza ni ffprobe ni hyperframes.** Casos:
  - 202 queued + `job.json`.
  - Los tres 400 del DTO.
  - GET done y rendering.
  - 404 y 400.
  - Vídeo 200 (bytes, `Content-Type` y `Content-Length`), 409 sin terminar, 409 `failed`, 404 y 400.

### Prueba real por HTTP (script temporal, no commiteado)
- Levanté `node dist/main.js` con `JOBS_DIR` en el scratchpad y envié el POST con `spike/ugc-template/assets/voice.mp3` y la alineación reconstruida desde `spike/jobs/sample-variables.json`.
  - **POST:** 202 en 26 ms.
  - **Vídeo pedido inmediatamente:** 409.
  - **Polling cada 1 s:** `rendering → done` en 34,9 s; `render_ms` 33 832.
  - **Descarga:** 200 `video/mp4`, 377 371 bytes (coincide con `Content-Length`).
  - **ffprobe:** **1080x1920, 6,0 s**, igual que el audio y que `duration_seconds`.
  - **Ids inválidos:** `GET /render-jobs/no-es-uuid` → 400; vídeo de un UUID inexistente → 404.
  - **Logs:** los 16 eventos JSON del job llevan `job_id` y `ai_model_used`.
- **Reinicio a mitad de render:**
  - Maté la app 3 s después del POST, con 24 `chrome-headless-shell` y el CLI vivos (`Get-CimInstance`).
  - 1,5 s después quedaban 0 Chrome, 0 ffmpeg y 0 CLI.
  - Al volver a arrancar, el job pasó a `failed` / `interrupted by restart`, y `started_at` y `duration_seconds` se conservaron.
- **Variación de tiempos:** un render de 6 s tardó entre 16 y 34 s según la ejecución. El mismo audio con 4 caracteres de subtítulo tardó 16 s. Con los 10 subtítulos de la muestra, 31–34 s.

## Pendiente

- **Limpieza de jobs (no implementada a propósito):** hoy nunca se borra nada de `JOBS_DIR`. Hay que decidir la retención (p. ej. borrar `failed` tras N días y `done` tras descargarse o tras N días) y si se conserva solo `job.json` como auditoría. Lo mismo para las carpetas a medio preparar de jobs fallidos.
- La cola se pierde al reiniciar: los jobs pendientes quedan en `failed` y n8n tiene que reenviarlos. Si hace falta reanudarlos, habría que persistir el payload (el audio) al encolar.
- Sin límite de tamaño de cola ni backpressure: un `POST` siempre devuelve 202.
- Medir con audios reales de 30–60 s, para ver si el timeout `30 + 10×d` sobra o falta.
- `ProcessTreeService` en Linux/Docker: hoy `supported = false` fuera de Windows, así que solo se hace `kill()`.

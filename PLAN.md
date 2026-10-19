# Plan del proyecto UGC Pipeline

Última actualización: 2026-10-19. Complementa a `CLAUDE.md` (reglas) con el estado y las decisiones.

## Objetivo
Pipeline automatizado de videos UGC verticales (9:16) para TikTok e Instagram, en fase de pruebas SIN costo. Cuando funcione, se exportará a otros sectores y negocios.

## Arquitectura
n8n (Docker, local) → OpenRouter (guion, solo modelos `:free`) → ElevenLabs (audio + timestamps, free tier) → `POST /render-jobs` en render-service (NestJS) → Hyperframes (CLI) → mp4.
n8n consulta el estado por polling (`GET /render-jobs/:id`) y descarga el video (`GET /render-jobs/:id/video`). Webhook de vuelta: más adelante.

## Estado por paso
| # | Paso | Estado |
| --- | --- | --- |
| 1 | Spike de Hyperframes (`spike/NOTES.md`) | Hecho (commit c35b02b) |
| 2 | Proyecto NestJS + `CLAUDE.md` | Hecho (8af3a40; migrado a ESM + Vitest en 6fe5784) |
| 3 | Contrato n8n ↔ NestJS: DTOs, `ValidationPipe`, `ai_model_used` obligatorio, `groupCharactersIntoWords` | Hecho (fa39007, cb72b74) |
| 4 | Módulo de render: workspace por job, ffprobe, runner con `spawn` y timeout (aedeacd) | Hecho |
| 4b | Cola (concurrencia 1), `job.json`, endpoints GET de estado y video | Hecho (59550e4) |
| 5 | Workflow de n8n (OpenRouter → ElevenLabs → render-service) | No empezado |
| 6 | Auditoría: log por job con modelo, duración y resultado | NestJS listo (logs JSON y `job.json`). Falta la parte de n8n |

Detalle técnico del render: `render-service/NOTES-RENDER.md`. Desvío ESM/Vitest: `render-service/NOTES-TEST-FIX.md`.

## Decisiones tomadas
- Resultado del render por polling (A). Webhook (B) queda para después.
- Timestamps de ElevenLabs por carácter (campo `alignment`); NestJS los agrupa en palabras. La puntuación queda pegada a la palabra.
- `ai_model_used` viaja en cada payload, DTO, log y `job.json`. El formato se valida como `proveedor/modelo[:variante]`; hoy NO se obliga el sufijo `:free`.
- Un render a la vez (cola en memoria, concurrencia 1). `--workers 4` explícito (configurable con `RENDER_WORKERS`).
- Cada job vive en `jobs/<job_id>/` (ignorada por git) con `job.json` como registro de auditoría.
- El CLI se ejecuta con `spawn` sin shell, con timeout `30 s + 10 s x duración` y `HYPERFRAMES_NO_TELEMETRY=1`.
- Nest 12 es solo ESM: proyecto en ESM + Vitest (reglas en `CLAUDE.md`).

## Pendiente (en orden aproximado)
1. Workflow de n8n: Docker, OpenRouter con salida JSON validada (reintento o fallback entre modelos free, registrando cuál se usó), ElevenLabs `with-timestamps`, POST al render-service, polling y descarga. Requiere API keys del usuario.
2. Diseño de la plantilla (hoy: fondo negro, hook y subtítulos básicos; el audio de prueba es un tono de relleno). Suavizar el parpadeo de subtítulos entre palabras.
3. Probar con voz real y videos de 30 a 60 s; confirmar el timeout.
4. Limpieza y retención de jobs (hoy nada se borra).
5. Más adelante: webhook de vuelta, `ProcessTreeService` fuera de Windows (Docker/Linux), reutilizar el pipeline en otros negocios.

## Cómo trabajar en este repo
- No asumir cosas del código sin ver los archivos relevantes.
- Respuestas concisas y centradas en el código; resumir al terminar en pocas líneas.
- Tareas pequeñas y verificables; correr tests, lint y build antes de dar algo por terminado.

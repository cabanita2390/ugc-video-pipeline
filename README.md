# UGC Video Pipeline: servicio de render en NestJS

Pipeline para generar videos verticales (9:16) de forma automatizada. Este repositorio contiene el **servicio de render** en NestJS que recibe un guion y un audio con marcas de tiempo, arma el proyecto del video y lo renderiza a MP4.

Proyecto personal, en desarrollo.

## Arquitectura

```
n8n (orquestador)
  → LLM (guion)
  → TTS con timestamps por carácter
  → POST /render-jobs  (este servicio, NestJS)
      → workspace por job + plantilla HTML/GSAP
      → Hyperframes CLI (spawn con timeout) → out.mp4
  ← GET /render-jobs/:id        (estado, por polling)
  ← GET /render-jobs/:id/video  (descarga)
```

## Lo que muestra este proyecto

- **NestJS 12 en ESM** con TypeScript estricto y **Vitest** (pruebas unitarias y e2e).
- **Contrato de entrada validado**: DTOs con class-validator y `ValidationPipe` global.
- **Cola de trabajos en memoria** (concurrencia 1) con estado por job y `job.json` como registro de auditoría.
- **Ejecución de procesos externos** con `spawn` (sin shell), timeout proporcional a la duración y limpieza del árbol de procesos.
- **Alineación de subtítulos**: agrupa timestamps por carácter en palabras (`groupCharactersIntoWords`, con tests).
- Validación del video final con **ffprobe**.
- Logs JSON por job con el modelo de IA usado.

## Estructura

```
render-service/src/render-jobs
├── dto/          # contrato de entrada (guion, alineación, modelo usado)
├── alignment/    # caracteres → palabras
├── queue/        # cola y almacenamiento del estado de cada job
└── rendering/    # workspace, runner de Hyperframes, ffprobe
spike/            # prueba de concepto inicial del CLI de render
PLAN.md           # estado del proyecto y decisiones técnicas
```

## Cómo correrlo

```bash
cd render-service
npm install
npm run start:dev
npm test
```

Requiere Node 22+, ffmpeg/ffprobe y el CLI de Hyperframes. Detalles en `PLAN.md` y `render-service/NOTES-RENDER.md`.

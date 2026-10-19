# UGC Pipeline

## Estado del proyecto
- Lee PLAN.md al empezar. Al terminar un paso, actualiza su fila en la tabla de estado y ajusta la lista de pendientes. No dupliques ahí detalles técnicos: van en NOTES-*.md.

## Arquitectura
- n8n (Docker, local) orquesta: OpenRouter (guion) → ElevenLabs (audio + timestamps) → POST a render-service.
- render-service (NestJS, TypeScript strict) recibe el payload, lo inyecta en una plantilla Hyperframes (HTML/CSS + GSAP) y ejecuta `npx hyperframes render`.
- Salida: video vertical 9:16.

## Reglas
- ZERO-COST: ningún servicio de pago. OpenRouter solo modelos `:free`; ElevenLabs free tier; n8n Community.
- AUDITORÍA: `ai_model_used` (id exacto del modelo de OpenRouter) viaja en cada payload, DTO y log. Nunca se omite.
- TypeScript strict, sin `any`. DTOs con class-validator. ValidationPipe global con whitelist.
- Ejecutar el CLI con `spawn` (nunca `exec` con strings interpolados), con timeout y cwd aislado por job.
- No asumir comportamiento del CLI de Hyperframes: verificar con `--help` y un render real.
- Cambios pequeños y verificables; correr lint/tests antes de dar algo por terminado.

## render-service: ESM + Vitest (Nest 12 es solo ESM; ver render-service/NOTES-TEST-FIX.md)
- El paquete es ESM (`"type": "module"`). No volver a CJS ni a Jest.
- Imports relativos siempre con extensión `.js` (`import { X } from './x.js'`), también en specs y en `test/`.
- Nada de `__dirname`, `__filename` ni `require`: usar `import.meta.dirname` / `import.meta.filename` y `createRequire(import.meta.url)` (p. ej. `createRequire(import.meta.url).resolve('hyperframes/package.json')`).
- Tests con Vitest (`globals: true`): `npm test` = unit `src/**/*.spec.ts`; `npm run test:e2e` = `test/**/*.e2e-spec.ts` con supertest. Mocks con `vi.fn()` / `vi.mock()` (no `jest.*`).
- `render-service/.npmrc` tiene `legacy-peer-deps=true` a propósito: npm 10 falla con `Cannot read properties of null (reading 'edgesOut')` al resolver los peers de vitest 4 + vite 8. No quitarlo; instalar con `npm ci`.
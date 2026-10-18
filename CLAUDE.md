# UGC Pipeline

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
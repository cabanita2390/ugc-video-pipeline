# Fix de `npm test`: Nest 12 (solo ESM) con Jest en CJS

Fecha: 2026-10-18 · Node v22.23.2 · npm 10.9.8 (el que trae Node) y 10.2.3 (global, en `%APPDATA%\npm`).
Todo lo de abajo se probó en copias del proyecto dentro del scratchpad. **El proyecto no se tocó**, salvo este archivo.

## Diagnóstico (verificado)

- `@nestjs/common`, `core`, `platform-express`, `testing` (12.1.3), `cli` y `schematics` son todos `"type": "module"`. No es solo `@nestjs/testing`.
- La app en producción **sí funciona** en CJS: `node dist/main.js` arranca y `GET /` responde `Hello World!`. Funciona porque Node ≥ 22.12 soporta `require(esm)` de forma nativa.
- Jest 30 tiene su propio cargador de módulos y no usa ese `require(esm)` en Node 22 (el mensaje de error sugiere Node 24.9+). Por eso fallan `npm test` (`app.controller.spec.ts`) y `npm run test:e2e`. Los dos fallan ya en HEAD con `Must use import to load ES Module`.
- El spec de `groupCharactersIntoWords` pasa porque no importa Nest.

## Opción A — seguir en CJS y ajustar Jest

### A1. Transformar los `.js` de `@nestjs` a CJS (`transformIgnorePatterns`) → **funciona, pero con un hack**

Configuración probada:
- `transformIgnorePatterns: ['/node_modules/(?!(@nestjs)/)']`.
- ts-jest también para `.js`, con un tsconfig propio: `module: commonjs`, `allowJs`, `isolatedModules`. Lleva además `moduleResolution: node10` + `ignoreDeprecations: "6.0"`, porque TS 6 marca `node10` como obsoleto y sin eso falla con TS5107.

Resultado:
- **Sin más cambios no basta.** `@nestjs/common/utils/load-package.util.js` usa `import.meta.url`, y TS no puede convertir eso a CJS. Esa suite sigue fallando con `Must use import to load ES Module`.
- **Con un transformer propio** (unas 8 líneas que envuelven ts-jest y reemplazan `import.meta.url` por `require('url').pathToFileURL(__filename).href`) **pasa todo**:
  - 3 suites, 10 tests: unit + `app.e2e-spec.ts`.
  - Un e2e de prueba con supertest: `POST /render-jobs` → 202 con payload válido; 400 si falta `ai_model_used`, si el DTO anidado es inválido o si llega un campo extra. Con eso quedan probados DI por tipo, ValidationPipe, `@Type` y whitelist.
- `jest.mock('node:child_process')`, `__dirname` y `require.resolve` funcionan como hoy.
- Tiempo: la 1.ª ejecución tarda ~6,2 s porque transforma todo Nest; con caché, ~2,4 s.
- Caveat: lo verifiqué con **una sola config** que corría unit y e2e juntos. En el cambio real hay que duplicarla en `test/jest-e2e.json`.

**Archivos que cambian:**
- `jest.config.ts` (transform + `transformIgnorePatterns`).
- `test/jest-e2e.json` (lo mismo).
- Nuevos: `tsconfig.jest.json` y `jest/import-meta-transformer.js`.
- Sin cambios en `src/`, deps ni `package.json`.

**Riesgos:**
- Se está parcheando con regex el código interno de Nest. Si Nest añade `import.meta.dirname`, top-level `await` (imposible de pasar a CJS) u otro patrón ESM, los tests se rompen de nuevo, aunque la app siga funcionando.
- Cada dependencia futura que sea solo ESM hay que añadirla a mano a `transformIgnorePatterns`.
- Los tests corren sobre un Nest transpilado por nosotros, no sobre el Nest que se ejecuta en producción.
- `moduleResolution: node10` dejará de funcionar en TS 7.

### A2. ts-jest en modo ESM (`useESM` + `extensionsToTreatAsEsm`), con el build en CJS → **pasa hoy, pero no sirve**

- Pasan las 3 suites (10 tests) sin hacks, en ~2 s, porque Jest carga Nest como ESM nativo.
- **Pero los tests corren como ESM y producción como CJS.** Lo comprobé con un spec de prueba:
  - `jest` no es global (hay que importarlo de `@jest/globals`).
  - `jest.mock` no se hoistea (habría que usar `jest.unstable_mockModule` + `import()` dinámico).
  - `__dirname` y `require` dan `ReferenceError`.
- Con eso, el código que use `require.resolve("hyperframes/package.json")` (lo propone `spike/NOTES.md`) o `__dirname` funciona en producción y falla en test, o al revés. Y mockear `spawn` se vuelve incómodo justo en el módulo que más lo necesita.
- Descartada.

### A3. (No probado) Subir a Node ≥ 24.9

Según el propio mensaje de Jest, desde Node 24.9 Jest soporta `require(esm)` de forma nativa. No lo verifiqué porque habría que descargar otro Node.

## Opción B — pasar a ESM + Vitest (lo que genera `nest new` en esta versión)

Lo verifiqué generando `nest new fresh --skip-install` con la CLI local (12.0.8). El scaffold trae:
- `"type": "module"` y vitest 4 + vite 8 + `@vitest/coverage-v8`.
- `vitest.config.ts` y `vitest.config.e2e.ts` (`globals: true`, `resolve.tsconfigPaths`).
- `types: ["vitest/globals", "node"]`.
- Imports relativos con `.js` y `await bootstrap()` en `main.ts`.
- No trae jest, ts-jest, ts-node, ts-loader ni tsconfig-paths.

Lo apliqué sobre una copia de nuestro proyecto. Resultado:
- `npm test`: 3 archivos, 12 tests OK (~1,0 s).
- `npm run test:e2e`: 2 archivos, 5 tests OK (~1,6 s). Incluye el `app.e2e-spec.ts` original y el mismo e2e de prueba de `POST /render-jobs` (202/400/400/400).
  - Confirma que el transform de Vite 8 emite `emitDecoratorMetadata`: la DI por tipo y class-transformer funcionan.
- `vi.mock('node:child_process')` se hoistea bien. `import.meta.dirname` y `createRequire(import.meta.url).resolve(...)` funcionan.
- `npm run build`, `tsc --noEmit` y `npm run lint` quedan limpios. `node dist/main.js` (ESM) arranca: `GET /` → `Hello World!` y `POST /render-jobs` con body inválido → 400.

**Archivos que cambian:**
- `package.json`:
  - `"type": "module"`.
  - Scripts `test*` → vitest.
  - Fuera: `jest`, `ts-jest`, `@types/jest`, `ts-node`, `ts-loader`, `tsconfig-paths`.
  - Dentro: `vitest`, `vite`, `@vitest/coverage-v8`.
- `package-lock.json`.
- `tsconfig.json`: `types`.
- Se borran `jest.config.ts` y `test/jest-e2e.json`; se añaden `vitest.config.ts` y `vitest.config.e2e.ts`.
- Se añade `.js` a todos los imports relativos: 12 archivos en `src/` + `test/app.e2e-spec.ts`, más `supertest/types` → `supertest/types.js`.
- Nada de lógica cambia.

**Riesgos:**
- **`npm install` falla con npm 10** (`Cannot read properties of null (reading 'edgesOut')`). Pasa tanto con el npm global 10.2.3 como con el 10.9.8 que trae Node, y **también con el scaffold puro de `nest new`**. Con `--legacy-peer-deps` instala bien. Habría que añadir `legacy-peer-deps=true` a un `.npmrc` del proyecto, o probar con npm 11 (no probado).
- El código futuro debe usar `import.meta.dirname` y `createRequire(import.meta.url)` en vez de `__dirname` y `require.resolve`. Hay que ajustar el ejemplo del spike al implementar el `spawn`.
- Los specs usan `vi.*` en vez de `jest.*`. Hoy no hay ninguno que lo use, así que el coste es cero.
- El diff es más grande (unos 17 archivos), aunque mecánico. Y el transform de los tests (oxc/Vite) no es el mismo que el del build (`tsc`). Hoy se comporta igual, incluidos los decoradores, pero es una diferencia a vigilar.

## Comparación

| | A1 (CJS + transform de Nest) | A2 (Jest ESM, build CJS) | B (ESM + Vitest) |
| --- | --- | --- | --- |
| `npm test` | ✅ (con hack de `import.meta`) | ✅ | ✅ |
| `npm run test:e2e` (supertest) | ✅ (verificado con config combinada) | ✅ | ✅ |
| Tests = semántica de producción | ✅ CJS, pero sobre un Nest transpilado | ❌ ESM vs CJS | ✅ ESM en ambos |
| Mock de `spawn` | ✅ `jest.mock` | ❌ `unstable_mockModule` | ✅ `vi.mock` |
| Archivos tocados | ~4 (solo config) | ~3 (solo config) | ~17 (config + `.js` en imports) |
| Deps nuevas | ninguna | ninguna | vitest, vite, coverage-v8 (necesita `legacy-peer-deps`) |
| Mantenimiento | frágil ante cambios internos de Nest | frágil por la divergencia | alineado con el scaffold oficial de Nest 12 |

## Recomendación

**B (ESM + Vitest).** Es lo que Nest 12 da por defecto y no depende de parchear código interno de Nest. Además, test y producción cargan los módulos igual. Y `vi.mock` de `child_process` funciona sin trucos, que es justo lo que hará falta para testear el `spawn` del render.

El coste es una migración mecánica que se hace una sola vez, y añadir `legacy-peer-deps=true` en `.npmrc`. Sugiero hacerla en un commit aislado, antes de escribir el módulo de render.

Si se prefiere no migrar ahora, A1 sirve como parche temporal, sabiendo que es frágil.

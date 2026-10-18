# Spike: CLI de Hyperframes

Fecha: 2026-10-17 · Windows 11 · PowerShell · Node v22.23.2 · CPU i5-1135G7 (8 hilos), 16 GB RAM, Intel Iris Xe.

Objetivo: verificar con `--help` y renders reales cómo se comporta `hyperframes render` antes de escribir el render-service.

## Resultado

Render 9:16 funcionando, con variables inyectadas desde un JSON, audio y subtítulos palabra por palabra:
`jobs/job-002/renders/out.mp4` → H.264 1080x1920 30 fps + AAC, 6,0 s, ~370 KB. Revisado frame a frame.

## Instalación (todo local, nada global)

```powershell
cd spike
npm init -y
npm install --save-dev --save-exact hyperframes@0.8.169
```

- Paquete npm: `hyperframes` (bin `hyperframes` → `bin/hyperframes.mjs`). `engines.node >= 22`.
- Usa `puppeteer-core` (no trae Chrome); el Chrome lo gestiona el propio CLI (ver dependencias).
- Versión fijada con `--save-exact`: los píxeles pueden cambiar entre versiones de CLI/Chrome.
- Además, solo como origen de los assets locales de la plantilla: `npm install --save-dev --save-exact gsap@3.14.2 @fontsource/inter@5.3.0`. GSAP tiene la licencia "Standard no charge" e Inter es OFL-1.1, así que ambos encajan en ZERO-COST.

## Dependencias del sistema (`npx hyperframes doctor --json`)

| Dependencia | Estado | Notas |
| --- | --- | --- |
| Node.js ≥ 22 | OK v22.23.2 | |
| FFmpeg / FFprobe | OK 9.0.2 (winget Gyan.FFmpeg, en PATH) | Obligatorio. Se puede forzar con `HYPERFRAMES_FFMPEG_PATH` / `HYPERFRAMES_FFPROBE_PATH`. |
| Chrome | OK `chrome-headless-shell` 152.0.7977.30 | Ya estaba en `~/.cache/hyperframes/chrome/` (de un uso previo). Si falta: `npx hyperframes browser ensure` (descarga en la caché del usuario). `browser path` imprime la ruta. |
| Docker | instalado, no corriendo | Solo para `render --docker`. No necesario. |
| whisper-cpp, Kokoro, MusicGen | no instalados | Opcionales (transcripción/TTS/música local). No necesarios: ElevenLabs da audio + timestamps. |

`doctor --json` siempre sale con código 0; hay que leer `checks[].ok`. Su `ok` global es `false` por los opcionales.

### Archivos que el CLI escribe fuera del proyecto
- `~/.cache/hyperframes/chrome/` — Chrome fijado.
- `~/.cache/hyperframes/fonts/inter/` — Inter descargada de Google Fonts, solo cuando la plantilla pide `Inter` sin `@font-face` local. La plantilla actual ya no la usa.
- `~/.hyperframes/config.json` — config de usuario. **Telemetría anónima: `enabled`** (no la cambié). En el spike la apagué solo por proceso con `HYPERFRAMES_NO_TELEMETRY=1`.
- `%TEMP%/hyperframes-extract-cache-*` — caché de frames de vídeo (vacía aquí; `--frames-cache-dir` la reubica).
- En cada proyecto/job: `.hyperframes/` (locks, reportes de `check`) y `renders/`.

### Red en tiempo de render (resuelto: la plantilla ya no depende de la red)
- **Antes:** el compile inlineaba GSAP desde el CDN (`Inlined CDN script: https://cdn.jsdelivr.net/...`) y descargaba Inter de Google Fonts (`Fetched 11 font face(s) for "Inter" from Google Fonts`).
- **Ahora:**
  - GSAP se carga con `<script src="assets/vendor/gsap-3.14.2.min.js">`. El CLI lo sirve con su servidor de archivos local.
  - Inter se declara con `@font-face` apuntando a `assets/fonts/inter-latin-{800,900}-normal.woff2`. El subset `latin` cubre á, é, í, ó, ú, ñ, ¿ y ¡.
- **Comprobado con `render --debug` (job-003):**
  - El log muestra `Embedded local font file: assets/fonts/inter-latin-800-normal.woff2 (24 KB → data URI)`, y lo mismo para el peso 900.
  - Ya no aparecen las líneas `Fetched … Google Fonts` ni `Inlined CDN script`.
  - El HTML compilado (`compiled/index.html`) tiene **0 URLs `http(s)://`**. Solo referencia `assets/vendor/gsap-3.14.2.min.js` y `assets/voice.mp3`, más 2 fuentes `data:font/woff2`.
  - Frames revisados a ojo: la tipografía es Inter Heavy/Black, igual que antes.
- **Caveat:** no corté la red físicamente; lo verifiqué con los logs y con el HTML compilado. El CLI sí consulta npm para comparar versiones (`latestVersion` en `doctor`), pero eso no afecta al render.
- **Ojo con `--debug`:** escribe los artefactos (frames, HTML compilado, audio) en `spike/node_modules/.debug/<renderJobId>/`, no en el job. Hay que borrarlos a mano.

## Comandos usados

```powershell
npx hyperframes --help
npx hyperframes render --help
npx hyperframes init --help
npx hyperframes doctor --json
npx hyperframes telemetry status
$env:HYPERFRAMES_SKIP_SKILLS='1'; npx hyperframes init demo --resolution portrait --non-interactive
npx hyperframes lint
npx hyperframes check --json
npx hyperframes render --quality draft --output renders/baseline.mp4
npx hyperframes render --quality draft --variables-file variables.json --strict-variables --output renders/out.mp4
node spawn-render.mjs jobs/job-002 looks      # spawn sin shell, igual que hará NestJS
ffprobe -v error -show_entries format=duration:stream=codec_name,width,height,r_frame_rate -of compact renders/out.mp4
```

- `init` sin `HYPERFRAMES_SKIP_SKILLS=1` comprueba/instala skills de IA contra GitHub (`--skip-skills` está "temporalmente ignorado"). Lo evité.
- `init` fuera de TTY usa el blank centrado sin preguntar.

## Flags de `render` relevantes para el pipeline

| Flag | Uso |
| --- | --- |
| `[DIR]` (posicional) | Directorio del proyecto. Usamos `.` con `cwd` = directorio del job. |
| `-o, --output` | Ruta de salida (default `renders/<name>.mp4`). |
| `-q, --quality` | `draft` · `looks` (default, CRF 16) · `delivery`. |
| `--variables-file <json>` | **Inyección del payload.** Objeto `{id: valor}`. Mejor que `--variables '<json>'`: evita escapar JSON en argv en Windows. |
| `--variables '<json>'` | Igual, inline. |
| `--strict-variables` | Falla si hay claves no declaradas o tipos erróneos. Usarlo siempre. |
| `--strict` / `--strict-all` | Falla por errores (o también warnings) de lint. |
| `-f, --fps` | Default: `data-fps` del root, si no 30. |
| `-w, --workers` | `auto` por defecto; cada worker es un Chrome (~256 MB). |
| `--format` | mp4 (default), webm, mov, gif, png-sequence, hls. |
| `--batch rows.json` | Un render por fila de variables. No probado. |
| `--browser-timeout`, `--protocol-timeout`, `--player-ready-timeout` | Timeouts internos (60 s / 300 s / 45 s por defecto). |
| `--quiet`, `--debug` | Menos / más log. |

`check` **no** acepta `--variables`: valida con los `default` de la plantilla.

## Estructura de la plantilla (`ugc-template/`)

```
ugc-template/
  index.html                              # composición raíz (HTML + CSS + GSAP)
  hyperframes.json                        # config del proyecto (copiado del scaffold)
  assets/voice.mp3                        # ruta FIJA del audio; el job copia aquí el mp3 de ElevenLabs
  assets/vendor/gsap-3.14.2.min.js        # copiado de node_modules/gsap/dist/gsap.min.js
  assets/fonts/inter-latin-800-normal.woff2  # de @fontsource/inter
  assets/fonts/inter-latin-900-normal.woff2
  assets/fonts/OFL-Inter.txt              # licencia de la fuente
```

Si la plantilla usa otro peso de Inter, hay que copiar su `.woff2` y añadir su `@font-face`. Si no, Chrome sintetiza el peso con la fuente de 800 o 900.

Contrato de `index.html` (verificado con lint + check + render):
- `<html data-composition-variables='[...]'>` declara las variables: `id`, `type` (`string|number|color|boolean|enum`), `label`, `default`. **No hay tipo array/objeto**: los timestamps viajan como `string` JSON y se hace `JSON.parse` al iniciar.
- Variables de la plantilla: `hook`, `words` (JSON `[{text,start,end}]`), `ai_model_used`, `accent`.
- Root: `<div id="root" data-composition-id="main" data-duration="6" data-width="1080" data-height="1920">`.
- Elementos con tiempo: `class="clip"` + `data-start` + `data-duration` (+ `data-track-index` opcional, solo para Studio).
- `data-var-text="hook"` sustituye texto sin script. Cada variable escalar también existe como CSS `var(--id)` (p. ej. `var(--accent)`).
- Lógica: `window.__hyperframes.getVariables()` una vez al iniciar. Se pueden crear clips desde script (los subtítulos se generan así y el render los respeta).
- Un único timeline GSAP pausado registrado en `window.__timelines["main"]`.
- Audio: `<audio id="voice" src="assets/voice.mp3" data-start="0">`. Necesita `id` (sin él se renderiza en silencio). **El `src` del audio no debe venir de una variable**: la extracción de audio lee el atributo escrito.
- Determinismo: nada de `Date.now()`, `Math.random()` ni fetch en tiempo de render.
- `ai_model_used` se escribe en `#root[data-ai-model-used]` (no aparece en el vídeo). Para la auditoría, el render-service debe registrarlo en sus logs y en un JSON junto al mp4.

### ⚠️ Hallazgo importante: duración del root
- `data-duration` del root se **fija en compile**: no se puede cambiar con variables ni desde script.
- Si se omite, el resultado es **inconsistente**: la duración del vídeo sale del audio (6 s), pero el root deja de ser visible al terminar el timeline GSAP (4,82 s). Los frames del 145 al 180 salieron vacíos, y además falló la captura `drawElement` (`No cached paint record`), con fallback a screenshot.
- **Solución verificada:** el render-service escribe `data-duration="<duración del audio>"` en el `index.html` de cada job. La duración se obtiene con ffprobe o del último timestamp de ElevenLabs.

## Flujo por job (simulado en `jobs/job-00N/`)

1. Copiar `ugc-template/` → `jobs/<jobId>/` (cwd aislado).
2. Copiar el audio → `jobs/<jobId>/assets/voice.mp3`.
3. Reescribir `data-duration` del root con la duración del audio.
4. Escribir `jobs/<jobId>/variables.json` (`hook`, `words`, `ai_model_used`, `accent`).
5. `spawn(process.execPath, [<node_modules/hyperframes/bin/hyperframes.mjs>, "render", ".", "--quality", "looks", "--variables-file", "variables.json", "--strict-variables", "--workers", "4", "--output", "renders/out.mp4"], { cwd: jobDir, shell: false, timeout })`.

Detalles de `spawn` en Windows (`spawn-render.mjs`):
- `npx` es `npx.cmd`: no se puede lanzar sin shell. Hay que ejecutar `node` (`process.execPath`) con la ruta del `.mjs`, resuelta con `require.resolve("hyperframes/package.json")`.
- **Progreso:** líneas `@hf-progress {"code":...,"pct":N}` en **stdout** (29 en un render de 6 s). Sirven para reportar el avance del job.
- **Logs** `[INFO]/[WARN] [Render...]` (JSON con `renderJobId`) en **stderr**. PowerShell los marca como `NativeCommandError` aunque el código de salida sea 0: no indican fallo.
- El resumen final va a stdout: `rendered in Xs` + desglose por fase.
- Código de salida 0 en todos los renders correctos.

## Tiempos de render

| Render | Calidad | Vídeo | Tiempo del CLI | Tiempo real (reloj) | Captura |
| --- | --- | --- | --- | --- | --- |
| `demo` baseline (texto estático, sin audio) | draft | 10 s, 300 frames | 19,2 s | 25,0 s | drawelement, 1 worker |
| `job-001` **sin** `data-duration` en el root (incorrecto) | draft | 6 s | 33,2 s | 39,3 s | drawelement → fallo → screenshot |
| `job-001` con `data-duration` | draft | 6 s, 180 frames | 20,4 s | 26,2 s | drawelement, 1 worker |
| `job-002` vía `spawn` | looks | 6 s, 180 frames | 26,4 s | 31,2 s | screenshot, 1 worker |

Desglose típico (job-002): compile 0,8 s · setup 7,8 s · capture 13,1 s · encode 3,5 s · assemble 0,5 s.
- La diferencia entre el tiempo real y el del CLI (~5 s) es el arranque de Node y del CLI.
- En los renders con la plantilla con CDN falló la calibración de workers: `suspect small frame (<20000B)`. El CLI bajó de 4 workers a 1.

### Comparación de `--workers` (plantilla con assets locales, `looks`, vídeo de 6 s)

Medido con `node spawn-render.mjs jobs/job-003 looks [workers]`, sin `--debug`. Hice dos ejecuciones por configuración, alternando `auto` y `4`.

| Configuración | Workers usados | Captura | Setup | Capture | Encode | Tiempo del CLI | Tiempo real |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Anterior: job-002 (CDN, `auto`) | 1 (calibración fallida) | screenshot | 7,8 s | 13,1 s | 3,5 s | 26,4 s | 31,2 s |
| `auto` | 4 (calibración OK) | screenshot | 9,1 s | 15,6–17,0 s | 4,9–5,2 s | 32,1 / 33,5 s | 37,4 / 38,9 s |
| **`--workers 4`** | 4 | screenshot | 0,5–0,7 s | 15,8 s | 5,4–5,8 s | **24,1 / 24,7 s** | **29,4 / 29,7 s** |
| `--workers 1` | 1 | drawelement (encode en streaming) | 0,6–0,8 s | 22,8–23,0 s (incluye encode) | — | 25,4 / 25,7 s | 30,9 / 31,1 s |

Conclusiones:
- **`--workers 4` explícito es el más rápido.** Frente al render anterior ahorra 2,0 s de CLI (−8 %) y 1,6 s de tiempo real. Frente a `auto` ahorra ~8,5 s (−26 %).
- **El ahorro viene de saltarse la calibración, no del paralelismo.** Con un número de workers explícito, el setup baja de ~9 s a ~0,6 s. Entre 4 workers y 1 la diferencia es solo ~1,2 s, porque con 4 la captura en paralelo (15,8 s) va seguida de un encode aparte (~5,5 s). Con 1 worker, el encode va en streaming durante la captura.
- Con esta plantilla de assets locales, `auto` sí pasó la calibración y eligió 4 workers. En la de CDN había fallado. El fallo aparece en algunos renders y en otros no, así que no conviene depender de `auto`.
- **El tamaño del archivo cambia con el número de workers:** 368,5 KB con 4 y 383,4 KB con 1, porque el modo de captura es distinto. El resultado es visualmente equivalente, pero no idéntico byte a byte.
- **Recomendación para render-service:** pasar siempre `--workers` explícito y configurable (`RENDER_WORKERS`, por defecto 4). Cada worker es un Chrome de ~256 MB, así que con 4 son ~1 GB.
- **Todavía sin medir:** con vídeos de 30–60 s el paralelismo debería pesar más que el coste fijo, así que la ventaja de 4 frente a 1 probablemente crece. Queda por confirmar.
- **Ritmo:** unos 4 s de render por cada segundo de vídeo de 6 s, de los que ~4–5 s son coste fijo.
- **El modo de captura no es estable:** el CLI decide `drawelement` o `screenshot` en cada ejecución, según la calibración y el número de workers.

## Pendiente / preguntas abiertas
- ~~Servir GSAP y la fuente desde archivos locales~~ → hecho. Ver "Red en tiempo de render".
- ~~Probar `--workers 4` explícito~~ → hecho. Ver "Comparación de `--workers`".
- Medir un render con duración real (30–60 s) y la voz real de ElevenLabs, comparando `--workers 4` frente a `--workers 1`.
- Verificar el render con la red físicamente cortada (por ejemplo, adaptador desactivado).
- Comprobar qué pasa con Chrome si `spawn` mata el proceso por timeout en Windows (¿quedan procesos huérfanos?).
- Definir el timeout del job a partir de la duración del vídeo (p. ej. 30 s + 10 × duración).

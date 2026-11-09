# Local development

`npm run dev`, `npm test`, `npm run build`, and `npm run preview` invoke `scripts/run.mjs` directly with Node. This avoids shell PATH splitting in directory names containing `:`.

Vite also rejects colon-containing absolute filenames in its strict file-access checks. When needed, the launcher uses a private cache at `~/Library/Caches/PaperPilot/<checkout-hash>/`. It copies installed dependencies when the lockfile changes, mirrors source/config/public assets, and runs tools there. It leaves Vite filesystem checks enabled and binds only to `127.0.0.1`.

During development, a recursive file watcher copies source edits to the runtime. The checkout remains authoritative. Build output is copied back to `dist/`; no source edits should be made directly in the cache. On a checkout path without a colon, commands run in place. The cache can be removed while all app commands are stopped; the next command recreates it.

Run one dev/build/test command at a time in this checkout because the mirror is shared. Restart the development server after changing dependencies. Node 22.12+ or 24+ is required by current development dependencies.

The server runs until Ctrl-C. Production preview needs `npm run build` first. Layouts use localStorage, scoped to the localhost origin; export/import JSON to move between ports or browsers.

## Asset preparation

All production assets are included under `public/`. No asset-generation step is needed to launch. `public/audio/prepare-assets.py` is an optional maintainer tool; see `docs/AUDIO-LICENSES.md`. Keep model WASM files synchronized with the exact installed MediaPipe version recorded in the lockfile.

## Architecture notes

Control polygons live in normalized paper coordinates. The renderer and hit tester share those polygons and the same homography. Raw camera coordinates are never inferred from CSS screen pixels. The camera remains unmirrored.

Web Audio dispatch runs before React visual updates. Model inference uses fresh video frames only, with no pending inference queue. Pinch input has separate press/release thresholds and locks a control until rearmed. Stale/no-hand observations release vision-owned audio; MIDI loss releases MIDI-owned audio. Window blur, hidden pages, mode changes, layout editing, and Stop all clear the session.

The hardware benchmark is intentionally not simulated. Browser-reported base/output latency and model inference duration appear separately from the unmeasured physical-to-sound field.

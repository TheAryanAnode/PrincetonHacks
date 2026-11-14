# PaperPilot

A local creative studio that turns a supported paper drawing into an aligned, playable controller. Built for a Mac and Chrome with React, TypeScript, Vite, MediaPipe, and Web Audio.

## Start

Requires Node.js 22.12+ or 24+ and npm. In this project folder:

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173** in Chrome. The app is local-first; apart from the optional AI mapping call, no accounts, backend, CDN, remote fonts, or runtime model/sample downloads are required. After the initial dependency install, the app can launch and play with the internet disconnected.

This checkout's parent folder contains a colon. The launcher automatically mirrors runtime files into a private, colon-free cache to work around npm/Vite path handling. Edit the original checkout normally; source changes are mirrored for hot reload. See [development notes](docs/DEVELOPMENT.md).

## How it works

1. **Take a picture** of your drawing (camera starts on its own; or **Use a photo instead**, or **Try without paper**).
2. Gemini finds the shapes and reads anything written inside them; the app then traces the exact outline you drew (see below) and draws the notes over the **live camera feed**.
3. **Tap a shape on the paper** to play it (or click it). Pick **1, 2 or 10 fingers**. Keyboard keys work too.
4. The **Game** tab has *Catch the light*: hit the glowing shape before it moves.

### Shapes → instruments

| Draw | Plays | Default notes |
|---|---|---|
| ▭ rectangle | Piano | C4, D4, E4… left to right |
| ◯ circle | Drums | kick, snare, hat, clap |
| △ triangle | Marimba | from C5 |
| ◇ diamond | Bass | from C2 |
| ☆ star | Sound FX | chime, orbit, pulse, bloom |
| other closed shape | Guitar | from C3 |

Organ and synth are also available. **Change instruments & notes** lets you set any shape to any instrument and note. Piano uses the bundled samples; the other instruments are synthesized in the browser (`src/lib/synth.ts`), so there are no extra downloads.

**Letters set the note.** Write a note inside a shape ("C", "F#", "Bb4") and that shape plays exactly that note, in the instrument's octave unless you write one. Turn this off with **Letters written in a shape set its note**. A sound name ("kick", "chime") written inside any shape always picks that sound.

### Exact outlines

Gemini's outlines are approximate. `src/lib/regions.ts` finds each patch of paper that your pen line encloses and uses that as the outline, so slanted keys, stars and wobbly circles are hit exactly where you drew them. Writing inside a shape is erased first, and a shape cut in two by writing is joined back together. A traced outline is used only if it confirms a shape Gemini found. With faint pencil, gray ruled lines or gaps in the line, the app keeps Gemini's outline instead. **Dark pen on plain or blue-lined paper gives the most exact outlines.**

### Tapping from a laptop webcam

A tap is a quick downward fingertip motion that brakes hard (`src/lib/tap.ts`). Tracking is smoothed, a finger re-arms after a small lift (so fast repeats register), entry into the frame isn't counted, and a finger that drops out of tracking for under 160 ms keeps its state. The hit point is the finger pad, a little past the fingertip, and near misses within about 7% of the frame still count. Keep the paper and camera still after the picture; retake it if either moves.

## Gemini (AI scan) and cost

```sh
echo "GEMINI_API_KEY=..." > .env.local   # https://aistudio.google.com/apikey (gitignored)
npm run dev
```

The key stays in the local Vite server (`server/identify.ts`, `POST /api/identify`) and never reaches the browser. The default model is `gemini-flash-lite-latest`; set `GEMINI_MODEL` to change it. If the model is busy, the server falls back to another model, and if AI fails the app uses the offline outline finder.

The **top bar shows Gemini spend**: scans, tokens (hover over it), and estimated dollars against a $5 budget. Each scan is about 1.1k input and 300 output tokens, roughly **$0.002**. The totals persist in `.gemini-usage.json` (gitignored). They are estimates from list price ($0.30 / $2.50 per 1M tokens), so the AI Studio billing page is the source of truth.

**Camera tapping is experimental.** One camera can't see contact; the tap thresholds were tuned on synthetic fingertip traces, not yet on a real webcam and desk. If taps misfire on your setup, adjust `TAP` in `src/lib/tap.ts`.

## Sound

- Bundled Salamander piano samples (C3–C6, repitched in between) and four drum hits plus four synth one-shots, all local.
- Separate voice ownership per input (keyboard, pointer, camera), so one input never cuts off another.

The game is a small lane/jump demo: A left, S jump, D right, F reset. Audio and example playback are disabled for the game.

## Validate and build

```sh
npm test
npm run build
npm run preview
```

`npm run build` writes a self-contained `dist/` folder. `npm run preview` serves it on localhost. Open the URL printed by Vite.

Tests cover homographies, forgiving hit testing, geometry validation, rectangle recognition, AI-shape mapping, tap detection, note ownership, camera cancellation, and tracker fresh/stale frames. Hardware acceptance remains manual; use [the rig checklist](docs/DEMO-CHECKLIST.md).

## Project map

- `src/App.tsx` — the Scan → Controls → Play flow, input routing, and the game.
- `server/identify.ts` — Gemini scan route and spend tracking (`/api/identify`, `/api/usage`).
- `src/lib/aiLayout.ts` / `regions.ts` / `tap.ts` / `synth.ts` — shapes → instruments and letters; exact traced outlines; fingertip taps; synthesized instruments.
- `src/lib/geometry.ts` / `recognition.ts` — projective transforms and setup-only rectangle detection.
- `src/lib/camera.ts` / `tracking.ts` — local input adapters and lifecycle handling.
- `src/lib/audio.ts` — decoded sample bank, envelopes, voice ownership, and effects.
- `public/models` / `public/audio` — all runtime assets and source/license notices.

Piano samples: Alexander Holm, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Full sources and processing details are in [audio attribution](docs/AUDIO-LICENSES.md). MediaPipe asset provenance is in [the model README](public/models/README.md).

# PrincetonHacks

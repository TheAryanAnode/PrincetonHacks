# PaperPilot

A local creative studio that turns a supported paper drawing into an aligned, playable controller. Built for a Mac and Chrome with React, TypeScript, Vite, MediaPipe, and Web Audio.

## Start

Requires Node.js 22.12+ or 24+ and npm. In this project folder:

```sh
npm install
npm run dev
```

Open **http://127.0.0.1:5173** in Chrome. The app is local only; no accounts, backend, CDN, remote fonts, or runtime model/sample downloads are required. After the initial dependency install, the app can launch and play with the internet disconnected.

This checkout's parent folder contains a colon. The launcher automatically mirrors runtime files into a private, colon-free cache to work around npm/Vite path handling. Edit the original checkout normally; source changes are mirrored for hot reload. See [development notes](docs/DEVELOPMENT.md).

## Try it immediately

1. Choose **Try the demo layout** to initialize local audio.
2. Play the eight controls with **A S D F G H J K**, or click the keys.
3. Try **Chords**, **Drums**, **Sounds**, and **Play** on the left rail. The geometry stays the same; mappings change.
4. Use **Edit layout** to move/resize controls, assign notes, add keys/pads, duplicate, delete, and undo.
5. **Bring it to life** saves the layout and opens Studio. The settings dialog also imports/exports layout JSON.
6. **Esc** or **Stop all** clears notes, sustain, example playback, and held game controls.

The first screen is a procedural illustration, explicitly labeled as a preview. It is not a fake camera feed.

## Use a real drawing

1. Draw eight closed rectangular keys with a thick black marker. Separate rectangles with small gaps are the easiest input; adjacent closed keys are also recognized. Avoid handwriting inside the controls during scanning.
2. Tape a landscape page flat under a fixed overhead camera with bright diffuse lighting.
3. Select the camera, click **Start camera**, and grant Chrome/macOS camera permission. Microphone access is never requested.
4. Lift your hands and click **Scan paper**. Drag corners **1–4 clockwise** around the paper: top left, top right, bottom right, bottom left.
5. Click **Detect controls**. Correct the detected bounds or add controls manually. If recognition fails, it reports failure; choose the eight-key template or add your own regions.
6. Click **Bring it to life**. Point your index tip at a control, then **pinch thumb to index to play**. Open the pinch to release/rearm. The active key stays locked until release. A cursor marks the detected index tip.
7. Keep the page fixed. Recalibrate through **Edit layout → Rescan and recalibrate** after moving the paper or camera.

**Camera input is an experimental, single-hand pinch gesture. It does not detect physical contact or reliably support arbitrary-paper piano tapping.** Camera latency, false positives, registration accuracy, and real rig reliability have not been measured. The model runs locally, one fresh frame at a time; slow/stale results are dropped. The live skin is translucent so hands remain visible; there is no pixel-accurate hand segmentation. Paper movement is not automatically detected.

## Sound and controls

- Real bundled Salamander piano samples, 13 anchor pitches covering C3–C6, repitched for intermediate notes. Fixed velocity, up to 48 voices.
- Studio Grand, a low-pass Soft Felt variant, and an explicit local synth preset/fallback.
- Release, sustain, master level, a small room effect, measured audio meter, and metronome.
- C / Am / F / G chord mappings, four drum hits, and four original synthesized soundboard clips.
- Example melody playback is illustrative and uses JavaScript timers. There is no loop recorder or audio-clock musical sequencer in this version.
- Piano samples have finite decay (at most seven seconds before pitch shifting). Sustain delays release but does not loop recordings indefinitely.
- Separate voice ownership for keyboard, pointer, camera, MIDI, and example playback. Tracking loss/disconnect bypasses sustain for the affected source.
- Optional wired MIDI input: **Settings → Connect MIDI**. Note numbers map to the original layout MIDI assignments. Multiple devices/channels retain independent ownership. No MPR121/Arduino firmware is included.

The game is a small lane/jump demo: A left, S jump, D right, F reset. Audio and example playback are disabled for the game.

## Validate and build

```sh
npm test
npm run build
npm run preview
```

`npm run build` writes a self-contained `dist/` folder. `npm run preview` serves it on localhost. Open the URL printed by Vite. Keep localhost ports stable if you want to reuse browser-saved layouts, or export/import the JSON.

Tests cover homographies, hit testing, invalid/overlapping geometry, rectangle recognition, imported layouts, note ownership, camera cancellation, MIDI disconnects, and tracker fresh/stale frames. Browser checks cover the demo, editing/undo, overlap prevention, app-mode changes, sample loading, and panic stop. Hardware acceptance remains manual; use [the rig checklist](docs/DEMO-CHECKLIST.md).

## Project map

- `src/App.tsx` — workflow, configuration, editor, input routing, and UI.
- `src/components/PaperStage.tsx` — shared polygon-based rendering and editing.
- `src/lib/geometry.ts` / `recognition.ts` — projective transforms and setup-only rectangle detection.
- `src/lib/camera.ts` / `tracking.ts` / `midi.ts` — local input adapters and lifecycle handling.
- `src/lib/audio.ts` — decoded sample bank, envelopes, voice ownership, and effects.
- `src/components/MiniGame.tsx` — small reusable control demo.
- `public/models` / `public/audio` — all runtime assets and source/license notices.

Piano samples: Alexander Holm, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Full sources and processing details are in [audio attribution](docs/AUDIO-LICENSES.md). MediaPipe asset provenance is in [the model README](public/models/README.md).

# PrincetonHacks

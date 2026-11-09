# Bundled hand tracking assets

These files are served locally. The camera pipeline makes no requests to a CDN or model host at runtime.

- `hand_landmarker.task`: MediaPipe Hand Landmarker float16 model, version 1, downloaded from https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task
- `wasm/`: unmodified WASM loaders and binaries from `@mediapipe/tasks-vision` 0.10.35 (Apache-2.0). They must stay in sync with the version installed by `package-lock.json`.
- Official API and model documentation: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker/web_js

The application detects one hand. The index tip is a pointing coordinate. A thumb/index pinch is an explicit experimental activation gesture; it does not establish that a finger touched the paper. Recommended pinch hysteresis is press below 0.35 and release above 0.50 (distance relative to palm width).

Inference runs on fresh decoded video frames, with GPU initialization and a CPU fallback. Inference time and completed-frame rate are diagnostics, not measured action-to-audio latency. The synchronous inference implementation should be benchmarked against a worker on the actual demonstration hardware before making latency claims.
